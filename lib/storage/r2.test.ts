import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { describe, expect, it, vi } from "vitest"

import { createR2Storage, type R2Command } from "./r2"

const BUCKET = "affilova-files"

type Sendable = { constructor: { name: string }; input: Record<string, unknown> }

function fakeStorage(options: { send?: (command: Sendable) => Promise<unknown> } = {}) {
  const sent: Sendable[] = []
  const presigned: { command: R2Command; expiresInSeconds: number }[] = []

  const storage = createR2Storage({
    client: {
      send: async (command: unknown) => {
        sent.push(command as Sendable)

        return options.send ? options.send(command as unknown as Sendable) : {}
      },
    } as never,
    presign: async (command, expiresInSeconds) => {
      presigned.push({ command, expiresInSeconds })

      return `https://signed.example/${expiresInSeconds}`
    },
    bucket: BUCKET,
  })

  return { storage, sent, presigned }
}

describe("presignPutUrl", () => {
  it("signs a PUT for exactly that key and size, for 15 minutes by default", async () => {
    const { storage, presigned } = fakeStorage()

    const url = await storage.presignPutUrl({
      key: "products/p/f/guide.pdf",
      contentType: "application/pdf",
      sizeBytes: 4096,
    })

    expect(url).toBe("https://signed.example/900")
    expect(presigned).toHaveLength(1)

    const [call] = presigned

    expect(call?.command).toBeInstanceOf(PutObjectCommand)
    expect(call?.expiresInSeconds).toBe(900)
    expect(call?.command.input).toMatchObject({
      Bucket: BUCKET,
      Key: "products/p/f/guide.pdf",
      ContentType: "application/pdf",
      ContentLength: 4096,
    })
  })

  it("takes a shorter lifetime when asked", async () => {
    const { storage, presigned } = fakeStorage()

    await storage.presignPutUrl({
      key: "k",
      contentType: "application/pdf",
      sizeBytes: 1,
      expiresInSeconds: 60,
    })

    expect(presigned[0]?.expiresInSeconds).toBe(60)
  })
})

describe("multipart", () => {
  it("returns the upload id", async () => {
    const { storage, sent } = fakeStorage({
      send: async () => ({ UploadId: "upload-123" }),
    })

    await expect(
      storage.createMultipartUpload({ key: "products/p/f/big.zip", contentType: "application/zip" }),
    ).resolves.toBe("upload-123")

    expect(sent[0]?.constructor.name).toBe(CreateMultipartUploadCommand.name)
    expect(sent[0]?.input).toMatchObject({
      Bucket: BUCKET,
      Key: "products/p/f/big.zip",
      ContentType: "application/zip",
    })
  })

  it("fails when the service does not return an id", async () => {
    const { storage } = fakeStorage({ send: async () => ({}) })

    await expect(
      storage.createMultipartUpload({ key: "k", contentType: "application/zip" }),
    ).rejects.toThrow("upload id")
  })

  it("signs a part for an hour by default", async () => {
    const { storage, presigned } = fakeStorage()

    await storage.presignPartUrl({ key: "k", uploadId: "upload-123", partNumber: 7 })

    const [call] = presigned

    expect(call?.command).toBeInstanceOf(UploadPartCommand)
    expect(call?.expiresInSeconds).toBe(3600)
    expect(call?.command.input).toMatchObject({
      Bucket: BUCKET,
      Key: "k",
      UploadId: "upload-123",
      PartNumber: 7,
    })
  })

  it("completes with every part, in order", async () => {
    const { storage, sent } = fakeStorage()

    await storage.completeMultipartUpload({
      key: "k",
      uploadId: "upload-123",
      parts: [
        { partNumber: 1, etag: "etag-1" },
        { partNumber: 2, etag: "etag-2" },
      ],
    })

    expect(sent[0]?.constructor.name).toBe(CompleteMultipartUploadCommand.name)
    expect(sent[0]?.input).toMatchObject({
      Bucket: BUCKET,
      Key: "k",
      UploadId: "upload-123",
      MultipartUpload: {
        Parts: [
          { PartNumber: 1, ETag: "etag-1" },
          { PartNumber: 2, ETag: "etag-2" },
        ],
      },
    })
  })

  it("aborts an upload", async () => {
    const { storage, sent } = fakeStorage()

    await storage.abortMultipartUpload({ key: "k", uploadId: "upload-123" })

    expect(sent[0]?.constructor.name).toBe(AbortMultipartUploadCommand.name)
    expect(sent[0]?.input).toMatchObject({ Bucket: BUCKET, Key: "k", UploadId: "upload-123" })
  })
})

describe("headObject", () => {
  it("returns the real size", async () => {
    const { storage, sent } = fakeStorage({
      send: async () => ({ ContentLength: 4096 }),
    })

    await expect(storage.headObject("k")).resolves.toEqual({ sizeBytes: 4096 })
    expect(sent[0]?.constructor.name).toBe(HeadObjectCommand.name)
    expect(sent[0]?.input).toMatchObject({ Bucket: BUCKET, Key: "k" })
  })

  it("returns null for a missing object", async () => {
    for (const error of [
      Object.assign(new Error("not found"), { name: "NotFound" }),
      Object.assign(new Error("no such key"), { name: "NoSuchKey" }),
      Object.assign(new Error("404"), { $metadata: { httpStatusCode: 404 } }),
    ]) {
      const { storage } = fakeStorage({
        send: async () => {
          throw error
        },
      })

      await expect(storage.headObject("k")).resolves.toBeNull()
    }
  })

  it("rethrows a real failure", async () => {
    const { storage } = fakeStorage({
      send: async () => {
        throw Object.assign(new Error("forbidden"), { $metadata: { httpStatusCode: 403 } })
      },
    })

    await expect(storage.headObject("k")).rejects.toThrow("forbidden")
  })
})

describe("deleteObject", () => {
  it("deletes the key", async () => {
    const { storage, sent } = fakeStorage()

    await storage.deleteObject("products/p/f/guide.pdf")

    expect(sent[0]?.constructor.name).toBe(DeleteObjectCommand.name)
    expect(sent[0]?.input).toMatchObject({
      Bucket: BUCKET,
      Key: "products/p/f/guide.pdf",
    })
  })
})

describe("copyObject", () => {
  it("copies from one key to another in the same bucket", async () => {
    const { storage, sent } = fakeStorage()

    await storage.copyObject({
      fromKey: "products/p/f/guide.pdf",
      toKey: "quarantine/products/p/f/guide.pdf",
    })

    expect(sent[0]?.constructor.name).toBe(CopyObjectCommand.name)
    expect(sent[0]?.input).toMatchObject({
      Bucket: BUCKET,
      CopySource: `${BUCKET}/products/p/f/guide.pdf`,
      Key: "quarantine/products/p/f/guide.pdf",
    })
  })
})

describe("presignGetUrl", () => {
  it("signs a download that is an attachment, for 5 minutes by default", async () => {
    const { storage, presigned } = fakeStorage()

    await storage.presignGetUrl({ key: "products/p/f/guide.pdf", filename: "guide.pdf" })

    const [call] = presigned

    expect(call?.command).toBeInstanceOf(GetObjectCommand)
    expect(call?.expiresInSeconds).toBe(300)
    expect(call?.command.input).toMatchObject({
      Bucket: BUCKET,
      Key: "products/p/f/guide.pdf",
      ResponseContentDisposition: 'attachment; filename="guide.pdf"',
    })
  })

  it("strips characters that would break the header", async () => {
    const { storage, presigned } = fakeStorage()

    await storage.presignGetUrl({
      key: "k",
      filename: 'we"ird\\name\r\n.pdf',
    })

    const command = presigned[0]?.command

    expect(command).toBeInstanceOf(GetObjectCommand)

    if (!(command instanceof GetObjectCommand)) {
      throw new Error("expected a GetObjectCommand")
    }

    expect(command.input.ResponseContentDisposition).toBe('attachment; filename="weirdname.pdf"')
  })

  it("falls back to a neutral name", async () => {
    const { storage, presigned } = fakeStorage()

    await storage.presignGetUrl({ key: "k", filename: '""' })

    const command = presigned[0]?.command

    expect(command).toBeInstanceOf(GetObjectCommand)

    if (!(command instanceof GetObjectCommand)) {
      throw new Error("expected a GetObjectCommand")
    }

    expect(command.input.ResponseContentDisposition).toBe('attachment; filename="download"')
  })
})

describe("logging", () => {
  it("never writes a signed URL anywhere", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const { storage } = fakeStorage()

    await storage.presignPutUrl({ key: "k", contentType: "application/pdf", sizeBytes: 1 })
    await storage.presignGetUrl({ key: "k", filename: "a.pdf" })

    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()

    log.mockRestore()
    warn.mockRestore()
    error.mockRestore()
  })
})

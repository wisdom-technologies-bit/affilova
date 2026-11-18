import "server-only"

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { getR2Env } from "@/lib/env"

// The private files bucket. Nothing in here logs: a presigned URL is a
// credential, valid until it expires, and a log line with one in it is a leak.
//
// The AWS client is injected rather than constructed here, so the tests exercise
// the real command objects without an HTTP layer or a mocking library.

/** Every command this module can hand to the presigner. */
export type R2Command =
  | PutObjectCommand
  | GetObjectCommand
  | UploadPartCommand

export type R2Client = Pick<S3Client, "send">

export interface R2StorageDependencies {
  client: R2Client
  /** Presigns a command locally. Injected so tests need no AWS. */
  presign: (command: R2Command, expiresInSeconds: number) => Promise<string>
  bucket: string
}

export interface CompletedPart {
  partNumber: number
  etag: string
}

export interface R2Storage {
  presignPutUrl: (input: {
    key: string
    contentType: string
    sizeBytes: number
    expiresInSeconds?: number
  }) => Promise<string>
  createMultipartUpload: (input: { key: string; contentType: string }) => Promise<string>
  presignPartUrl: (input: {
    key: string
    uploadId: string
    partNumber: number
    expiresInSeconds?: number
  }) => Promise<string>
  completeMultipartUpload: (input: {
    key: string
    uploadId: string
    parts: readonly CompletedPart[]
  }) => Promise<void>
  abortMultipartUpload: (input: { key: string; uploadId: string }) => Promise<void>
  headObject: (key: string) => Promise<{ sizeBytes: number } | null>
  deleteObject: (key: string) => Promise<void>
  /** Copy one object to another key in the same bucket. */
  copyObject: (input: { fromKey: string; toKey: string }) => Promise<void>
  presignGetUrl: (input: {
    key: string
    filename: string
    expiresInSeconds?: number
  }) => Promise<string>
}

// R2 answers a missing object with a 404, and the SDK surfaces that as either a
// named error or a status code depending on the call.
function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false
  }

  const name = (error as { name?: unknown }).name

  if (name === "NotFound" || name === "NoSuchKey") {
    return true
  }

  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode

  return status === 404
}

// A filename in a Content-Disposition header cannot carry a quote, a backslash
// or a line break.
function safeDownloadName(filename: string): string {
  const cleaned = filename.replace(/["\\\r\n]/g, "").trim()

  return cleaned === "" ? "download" : cleaned
}

export function createR2Storage(deps: R2StorageDependencies): R2Storage {
  const { client, presign, bucket } = deps

  return {
    presignPutUrl: ({ key, contentType, sizeBytes, expiresInSeconds = 900 }) =>
      presign(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: sizeBytes,
        }),
        expiresInSeconds,
      ),

    createMultipartUpload: async ({ key, contentType }) => {
      const result = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
        }),
      )

      if (typeof result.UploadId !== "string" || result.UploadId === "") {
        throw new Error("The storage service did not return an upload id")
      }

      return result.UploadId
    },

    presignPartUrl: ({ key, uploadId, partNumber, expiresInSeconds = 3600 }) =>
      presign(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        expiresInSeconds,
      ),

    completeMultipartUpload: async ({ key, uploadId, parts }) => {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.etag,
            })),
          },
        }),
      )
    },

    abortMultipartUpload: async ({ key, uploadId }) => {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        }),
      )
    },

    headObject: async (key) => {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        )

        return { sizeBytes: result.ContentLength ?? 0 }
      } catch (error) {
        if (isNotFound(error)) {
          return null
        }

        throw error
      }
    },

    deleteObject: async (key) => {
      // S3 and R2 both treat a delete of a missing key as a success, which is
      // what a cleanup sweep wants.
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },

    copyObject: async ({ fromKey, toKey }) => {
      // CopySource names the source object as bucket/key. The key is built from
      // uuids and slashes only, so it needs no escaping; encoding it anyway
      // would turn a genuine "+" in a name into a space.
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${fromKey}`,
          Key: toKey,
        }),
      )
    },

    presignGetUrl: ({ key, filename, expiresInSeconds = 300 }) =>
      presign(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${safeDownloadName(filename)}"`,
        }),
        expiresInSeconds,
      ),
  }
}

let storage: R2Storage | undefined

/** The real storage, built from the environment on first use. */
export function getR2Storage(): R2Storage {
  if (storage) {
    return storage
  }

  const env = getR2Env()
  const client = new S3Client({
    // R2 ignores the region but the SDK requires one.
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  })

  storage = createR2Storage({
    client,
    // Every command in R2Command is built for this same client, so the
    // presigner handles all of them. TypeScript cannot prove that for a union
    // of command classes, so the command is narrowed to one of the three at the
    // type level only. Nothing about the value changes.
    presign: (command, expiresInSeconds) =>
      getSignedUrl(client, command as PutObjectCommand, { expiresIn: expiresInSeconds }),
    bucket: env.R2_BUCKET_FILES,
  })

  return storage
}

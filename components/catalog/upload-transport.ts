"use client"

import {
  abortFileUploadAction,
  completeMultipartAction,
  confirmFileUploadAction,
  getPartUrlsAction,
  startFileUploadAction,
} from "@/lib/catalog/actions/vendor"
import { PartUploadError, type UploadTransport } from "@/lib/catalog/upload-client"

// The real transport: the server actions, and XMLHttpRequest for the bytes.
//
// XMLHttpRequest rather than fetch because a fetch upload has no progress
// event, and a 500 MB file with no progress bar looks like a frozen page. It is
// also the only way to read the ETag response header for a part.

function put(input: {
  url: string
  body: Blob
  contentType: string
  onProgress: (loaded: number) => void
  signal: AbortSignal
}): Promise<{ etag: string | null }> {
  return new Promise((resolve, reject) => {
    if (input.signal.aborted) {
      reject(new PartUploadError("The upload was cancelled.", { retryable: false }))

      return
    }

    const request = new XMLHttpRequest()

    request.open("PUT", input.url, true)

    if (input.contentType !== "") {
      request.setRequestHeader("Content-Type", input.contentType)
    }

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        input.onProgress(event.loaded)
      }
    }

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve({ etag: request.getResponseHeader("ETag") })

        return
      }

      // A signed URL that has run out of time answers 403, and that is the one
      // case worth asking the server for a fresh URL before trying again.
      if (request.status === 403) {
        reject(
          new PartUploadError("The upload link expired. Getting a new one.", {
            retryable: true,
            expired: true,
          }),
        )

        return
      }

      reject(
        new PartUploadError(
          request.status >= 500
            ? "The storage service did not accept the upload. Trying again."
            : `The upload was refused (status ${request.status}).`,
          { retryable: request.status >= 500 },
        ),
      )
    }

    request.onerror = () => {
      reject(new PartUploadError("The upload was interrupted.", { retryable: true }))
    }

    request.ontimeout = () => {
      reject(new PartUploadError("The upload timed out.", { retryable: true }))
    }

    request.onabort = () => {
      reject(new PartUploadError("The upload was cancelled.", { retryable: false }))
    }

    input.signal.addEventListener("abort", () => request.abort(), { once: true })

    request.send(input.body)
  })
}

/** The transport the file upload manager uses in a browser. */
export function createUploadTransport(): UploadTransport {
  return {
    start: (input) => startFileUploadAction(input),

    putObject: async (input) => {
      await put({
        url: input.url,
        body: input.body as Blob,
        contentType: input.contentType,
        onProgress: input.onProgress,
        signal: input.signal,
      })
    },

    putPart: async (input) => {
      // Each part is raw bytes: no Content-Type header, or S3 signs the part
      // differently from the URL it was asked for.
      const result = await put({
        url: input.url,
        body: input.body as Blob,
        contentType: "",
        onProgress: input.onProgress,
        signal: input.signal,
      })

      return { etag: result.etag }
    },

    partUrls: (input) => getPartUrlsAction(input),
    complete: (input) => completeMultipartAction(input),
    confirm: (input) => confirmFileUploadAction(input),
    abort: (input) => abortFileUploadAction(input),
  }
}

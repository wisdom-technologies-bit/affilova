import { describe, expect, it, vi } from "vitest"

import { postScanRequest, SCAN_REQUEST_TIMEOUT_MS, type ScanRequestInput } from "./client"

// The scanner client is tested through an injected fetch, so every status code
// the contract names is exercised without a network.

const INPUT: ScanRequestInput = {
  scanId: "30000000-0000-4000-8000-000000000001",
  fileId: "20000000-0000-4000-8000-000000000001",
  downloadUrl: "https://files.example.com/private/token?signature=secret-value",
  expectedSizeBytes: 1024,
  extension: "pdf",
  callbackUrl: "https://app.example.com/api/internal/scan-result",
}

function answerWith(status: number) {
  return vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch
}

function deps(fetchImpl: typeof fetch) {
  return {
    baseUrl: "https://scanner.example.com",
    sharedSecret: "0123456789abcdef0123456789abcdef",
    fetch: fetchImpl,
  }
}

describe("postScanRequest", () => {
  it("posts the contract body with a bearer token to /scan", async () => {
    const fetchImpl = answerWith(202)

    const result = await postScanRequest(deps(fetchImpl), INPUT)

    expect(result).toEqual({ ok: true })

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]

    expect(url).toBe("https://scanner.example.com/scan")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer 0123456789abcdef0123456789abcdef",
    )

    expect(JSON.parse(String(init.body))).toEqual({
      scanId: INPUT.scanId,
      fileId: INPUT.fileId,
      downloadUrl: INPUT.downloadUrl,
      expectedSizeBytes: 1024,
      extension: "pdf",
      callbackUrl: INPUT.callbackUrl,
    })
  })

  it("does not double the slash when the base URL ends in one", async () => {
    const fetchImpl = answerWith(202)

    await postScanRequest(
      { ...deps(fetchImpl), baseUrl: "https://scanner.example.com/" },
      INPUT,
    )

    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string]

    expect(url).toBe("https://scanner.example.com/scan")
  })

  it.each([
    [400, false],
    [401, false],
    [404, false],
    [429, true],
    [500, true],
    [503, true],
  ])("answers %i as retryable=%s", async (status, retryable) => {
    const result = await postScanRequest(deps(answerWith(status)), INPUT)

    expect(result).toEqual({ ok: false, retryable })
  })

  it("treats a network failure as retryable", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch

    expect(await postScanRequest(deps(failing), INPUT)).toEqual({ ok: false, retryable: true })
  })

  it("treats a timeout as retryable and aborts the request", async () => {
    let aborted = false

    const slow = vi.fn(
      async (_url: string, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true
            reject(new DOMException("aborted", "AbortError"))
          })
        }),
    ) as unknown as typeof fetch

    const result = await postScanRequest(
      { ...deps(slow), timeoutMs: 5 },
      INPUT,
    )

    expect(result).toEqual({ ok: false, retryable: true })
    expect(aborted).toBe(true)
  })

  it("defaults to a ten second timeout", () => {
    expect(SCAN_REQUEST_TIMEOUT_MS).toBe(10_000)
  })
})

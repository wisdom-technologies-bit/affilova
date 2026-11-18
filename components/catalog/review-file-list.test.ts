import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

// The review screen's file list: what a reviewer can do with a file whose scan
// did not settle, and what nobody can do with a file the scanner refused.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

vi.mock("@/lib/catalog/actions/admin", () => ({
  getReviewFileDownloadUrlAction: vi.fn(async () => ({ ok: true, url: "https://signed.example" })),
  reviewFileScanAction: vi.fn(async () => ({ ok: true })),
}))

import { ReviewFileList } from "@/components/catalog/review-file-list"
import type { ProductFile } from "@/lib/catalog/action-types"

const BASE: ProductFile = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  originalName: "guide.pdf",
  contentType: "application/pdf",
  sizeBytes: 4096,
  status: "uploaded",
  scanStatus: "clean",
  scanDetail: null,
  scannedAt: "2026-11-17T10:00:00.000Z",
  createdAt: "2026-11-16T10:00:00.000Z",
}

function render(file: ProductFile): string {
  return renderToStaticMarkup(createElement(ReviewFileList, { files: [file] }))
}

describe("ReviewFileList", () => {
  it("offers a download for a clean file, and no scan decision", () => {
    const html = render(renderFilePlaceholder())

    expect(html).toContain("Download for inspection")
    expect(html).toContain("Clean")
    expect(html).not.toContain("Mark clean")
    expect(html).not.toContain(">Reject<")
  })

  it("offers both decisions for a file under manual review", () => {
    const html = render({ ...BASE, scanStatus: "needs_review", scanDetail: "archive_contains_executable" })

    expect(html).toContain("Under manual review")
    expect(html).toContain("Mark clean")
    expect(html).toContain("Reject")
  })

  it("offers both decisions for a file whose scan failed", () => {
    const html = render({ ...BASE, scanStatus: "error", scanDetail: "download_failed" })

    expect(html).toContain("Scan failed, retrying")
    expect(html).toContain("Mark clean")
    expect(html).toContain("Reject")
  })

  it("does not let anyone download an infected file, and says why", () => {
    const html = render({ ...BASE, scanStatus: "infected", scanDetail: "Eicar-Test-Signature" })

    expect(html).toContain("Rejected: malware detected")
    expect(html).not.toContain("Download for inspection")
    expect(html).toContain("Not available: this file was found to contain malware.")
  })

  it("does not let anyone download a rejected file, and says why", () => {
    const html = render({ ...BASE, scanStatus: "rejected", scanDetail: "executable_type" })

    expect(html).toContain("Rejected: this file type or content is not allowed")
    expect(html).toContain("Program files are not accepted.")
    expect(html).not.toContain("Download for inspection")
    expect(html).toContain("Not available: this file type or its contents are not allowed.")
  })

  it("offers no decision on an infected file", () => {
    const html = render({ ...BASE, scanStatus: "infected" })

    expect(html).not.toContain("Mark clean")
  })
})

/** The clean case, written out so the placeholder reads as one file. */
function renderFilePlaceholder(): ProductFile {
  return BASE
}

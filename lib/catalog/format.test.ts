import { describe, expect, it } from "vitest"

import {
  affiliateApprovalLabel,
  fileStatusLabel,
  formatBytes,
  formatLagosDate,
  formatLagosDateTime,
  formatPercent,
  koboToNairaInput,
  NOT_SET,
  percentToBps,
  productStatusLabel,
  refundWindowLabel,
  REFUND_WINDOW_OPTIONS,
  scanStatusLabel,
  statusTabFromParam,
  timeAgo,
} from "./format"

describe("dates are shown in Lagos time", () => {
  it("formats a day", () => {
    expect(formatLagosDate("2026-11-18T13:05:00.000Z")).toBe("18 Nov 2026")
  })

  it("formats a day and a time, an hour ahead of UTC", () => {
    expect(formatLagosDateTime("2026-11-18T13:05:00.000Z")).toBe("18 Nov 2026, 14:05")
  })

  it("rolls over to the next Lagos day when UTC is still yesterday", () => {
    expect(formatLagosDateTime("2026-11-18T23:30:00.000Z")).toBe("19 Nov 2026, 00:30")
  })

  it("says Not set rather than showing a placeholder date", () => {
    expect(formatLagosDate(null)).toBe(NOT_SET)
    expect(formatLagosDateTime(undefined)).toBe(NOT_SET)
    expect(formatLagosDate("not-a-date")).toBe(NOT_SET)
  })
})

describe("timeAgo", () => {
  const now = new Date("2026-11-18T12:00:00.000Z")

  it("counts in whole units", () => {
    expect(timeAgo("2026-11-18T11:59:40.000Z", now)).toBe("less than a minute")
    expect(timeAgo("2026-11-18T11:58:00.000Z", now)).toBe("2 minutes")
    expect(timeAgo("2026-11-18T09:00:00.000Z", now)).toBe("3 hours")
    expect(timeAgo("2026-11-16T12:00:00.000Z", now)).toBe("2 days")
  })

  it("uses the singular for one", () => {
    expect(timeAgo("2026-11-18T11:00:00.000Z", now)).toBe("1 hour")
    expect(timeAgo("2026-11-17T12:00:00.000Z", now)).toBe("1 day")
  })

  it("never counts backwards", () => {
    expect(timeAgo("2026-11-18T13:00:00.000Z", now)).toBe("less than a minute")
  })
})

describe("file sizes", () => {
  it("shows bytes, kilobytes, megabytes and gigabytes", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(999)).toBe("999 B")
    expect(formatBytes(1024)).toBe("1 KB")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(100 * 1024 * 1024)).toBe("100 MB")
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2 GB")
  })

  it("refuses a size that is not a whole, non-negative number", () => {
    expect(() => formatBytes(-1)).toThrow(TypeError)
    expect(() => formatBytes(1.5)).toThrow(TypeError)
  })
})

describe("percentages", () => {
  it("reads basis points as a percentage", () => {
    expect(formatPercent(500)).toBe("5")
    expect(formatPercent(2000)).toBe("20")
    expect(formatPercent(2250)).toBe("22.5")
  })

  it("accepts a whole percent between 5 and 80", () => {
    expect(percentToBps("5")).toBe(500)
    expect(percentToBps("20")).toBe(2000)
    expect(percentToBps("80")).toBe(8000)
    expect(percentToBps(" 25 ")).toBe(2500)
  })

  it("refuses anything else", () => {
    expect(percentToBps("")).toBeNull()
    expect(percentToBps("4")).toBeNull()
    expect(percentToBps("81")).toBeNull()
    expect(percentToBps("20.5")).toBeNull()
    expect(percentToBps("-20")).toBeNull()
    expect(percentToBps("twenty")).toBeNull()
  })
})

describe("money in inputs", () => {
  it("turns kobo back into the string a price field starts with", () => {
    expect(koboToNairaInput(150_000)).toBe("1500")
    expect(koboToNairaInput(150_050)).toBe("1500.50")
    expect(koboToNairaInput(99)).toBe("0.99")
    expect(koboToNairaInput(null)).toBe("")
    expect(koboToNairaInput(undefined)).toBe("")
  })
})

describe("words for statuses", () => {
  it("names every product status", () => {
    expect(productStatusLabel("draft")).toBe("Draft")
    expect(productStatusLabel("submitted")).toBe("Submitted")
    expect(productStatusLabel("live")).toBe("Live")
    expect(productStatusLabel("paused")).toBe("Paused")
    expect(productStatusLabel("rejected")).toBe("Rejected")
    expect(productStatusLabel("archived")).toBe("Archived")
  })

  it("names every scan status", () => {
    expect(scanStatusLabel("not_scanned")).toBe("Not scanned")
    expect(scanStatusLabel("clean")).toBe("Clean")
    expect(scanStatusLabel("infected")).toBe("Rejected: malware detected")
    expect(scanStatusLabel("error")).toBe("Scan failed")
  })

  it("names the two upload states", () => {
    expect(fileStatusLabel("pending")).toBe("Uploading")
    expect(fileStatusLabel("uploaded")).toBe("Uploaded")
  })

  it("names the affiliate approvals", () => {
    expect(affiliateApprovalLabel("open")).toContain("Open")
    expect(affiliateApprovalLabel("approval")).toBe("Approval required")
    expect(affiliateApprovalLabel("invite")).toBe("Invite only")
  })

  it("names the refund windows the form offers", () => {
    expect([...REFUND_WINDOW_OPTIONS]).toEqual([24, 72, 168, 336, 720])
    expect(refundWindowLabel(24)).toBe("24 hours")
    expect(refundWindowLabel(72)).toBe("3 days")
    expect(refundWindowLabel(720)).toBe("30 days")
    expect(refundWindowLabel(48)).toBe("48 hours")
  })
})

describe("the status tab in the query string", () => {
  it("accepts a known status", () => {
    expect(statusTabFromParam("live")).toBe("live")
    expect(statusTabFromParam("all")).toBe("all")
  })

  it("falls back to all for anything else", () => {
    expect(statusTabFromParam(undefined)).toBe("all")
    expect(statusTabFromParam("wizard")).toBe("all")
    expect(statusTabFromParam("")).toBe("all")
  })
})

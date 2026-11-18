// Pure formatting for the catalog screens: dates, file sizes, status words.
//
// Nothing here reads the environment or the session, so a client component and
// a test can both use it. Dates are shown in Africa/Lagos, which is the clock
// every vendor and every reviewer in this market works to.

const DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  day: "2-digit",
  month: "short",
  year: "numeric",
})

const TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

/** The word used where a date has not happened yet. Never a dash or a zero date. */
export const NOT_SET = "Not set"

function parse(iso: string | null | undefined): Date | null {
  if (typeof iso !== "string" || iso === "") {
    return null
  }

  const date = new Date(iso)

  return Number.isNaN(date.getTime()) ? null : date
}

/** "18 Nov 2026" in Lagos time, or "Not set". */
export function formatLagosDate(iso: string | null | undefined): string {
  const date = parse(iso)

  return date === null ? NOT_SET : DATE.format(date)
}

/** "18 Nov 2026, 14:05" in Lagos time, or "Not set". */
export function formatLagosDateTime(iso: string | null | undefined): string {
  const date = parse(iso)

  return date === null ? NOT_SET : `${DATE.format(date)}, ${TIME.format(date)}`
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * How long ago something happened, for the review queue: "4 minutes",
 * "3 hours", "2 days". Whole units only, and never a negative age.
 */
export function timeAgo(iso: string | null | undefined, now: Date): string {
  const date = parse(iso)

  if (date === null) {
    return NOT_SET
  }

  const elapsed = Math.max(now.getTime() - date.getTime(), 0)

  if (elapsed < MINUTE_MS) {
    return "less than a minute"
  }

  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS)

    return minutes === 1 ? "1 minute" : `${minutes} minutes`
  }

  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS)

    return hours === 1 ? "1 hour" : `${hours} hours`
  }

  const days = Math.floor(elapsed / DAY_MS)

  return days === 1 ? "1 day" : `${days} days`
}

const SIZE_UNITS = ["B", "KB", "MB", "GB"] as const

/** "1.5 MB". Binary units, one decimal below ten, and never "0.0 B". */
export function formatBytes(bytes: number): string {
  if (!Number.isInteger(bytes) || bytes < 0) {
    throw new TypeError("formatBytes expects a whole, non-negative number of bytes")
  }

  let unit = 0
  let size = bytes

  while (size >= 1024 && unit < SIZE_UNITS.length - 1) {
    unit += 1
    size = Math.floor(size / 1024)
  }

  if (unit === 0) {
    return `${bytes} B`
  }

  // Tenths from the exact byte count, so 1536 bytes reads "1.5 KB".
  const scale = 1024 ** unit
  const tenths = Math.round((bytes * 10) / scale)
  const whole = Math.floor(tenths / 10)
  const remainder = tenths % 10

  return remainder === 0
    ? `${whole} ${SIZE_UNITS[unit]}`
    : `${whole}.${remainder} ${SIZE_UNITS[unit]}`
}

const STATUS_WORDS = {
  draft: "Draft",
  submitted: "Submitted",
  live: "Live",
  paused: "Paused",
  rejected: "Rejected",
  archived: "Archived",
} as const

export type KnownProductStatus = keyof typeof STATUS_WORDS

export function productStatusLabel(status: KnownProductStatus): string {
  return STATUS_WORDS[status]
}

/** The status tabs on the product list, "all" first. */
export const PRODUCT_STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "live", label: "Live" },
  { value: "paused", label: "Paused" },
  { value: "rejected", label: "Rejected" },
  { value: "archived", label: "Archived" },
] as const

export type StatusTab = (typeof PRODUCT_STATUS_TABS)[number]["value"]

/** The status tab a query parameter asks for, or "all" for anything unknown. */
export function statusTabFromParam(value: string | undefined): StatusTab {
  return PRODUCT_STATUS_TABS.find((tab) => tab.value === value)?.value ?? "all"
}

// Every state of a file's malware scan, in the words a vendor and a reviewer
// both read. A status is never shown by colour alone: each of these is text.
const SCAN_WORDS = {
  not_scanned: "Not scanned yet",
  queued: "Waiting for security scan",
  scanning: "Scanning",
  clean: "Clean",
  infected: "Rejected: malware detected",
  rejected: "Rejected: this file type or content is not allowed",
  needs_review: "Under manual review",
  error: "Scan failed, retrying",
} as const

export type KnownScanStatus = keyof typeof SCAN_WORDS

export function scanStatusLabel(status: KnownScanStatus): string {
  return SCAN_WORDS[status]
}

// The scanner's rejection codes, in plain language. This is shown under the
// label, so a vendor knows what to do differently rather than just that the file
// was refused.
const SCAN_DETAIL_WORDS: Readonly<Record<string, string>> = {
  type_mismatch: "The file's content does not match its extension.",
  encrypted_archive: "Password-protected archives are not accepted.",
  archive_limits: "The archive is too large or too deeply nested.",
  path_traversal: "The archive contains unsafe paths.",
  symlink: "The archive contains unsafe paths.",
  executable_type: "Program files are not accepted.",
  size_mismatch: "The upload was incomplete.",
}

/** The plain-language line for a rejection code, or null when there is none. */
export function scanDetailLabel(detail: string | null | undefined): string | null {
  if (typeof detail !== "string" || detail === "") {
    return null
  }

  return SCAN_DETAIL_WORDS[detail] ?? null
}

/** True while the answer is still coming: the screen polls for these. */
export function isScanPending(status: KnownScanStatus): boolean {
  return status === "queued" || status === "scanning"
}

const FILE_WORDS = {
  pending: "Uploading",
  uploaded: "Uploaded",
} as const

export type KnownFileStatus = keyof typeof FILE_WORDS

export function fileStatusLabel(status: KnownFileStatus): string {
  return FILE_WORDS[status]
}

const APPROVAL_WORDS = {
  open: "Open: any affiliate may promote it",
  approval: "Approval required",
  invite: "Invite only",
} as const

export type KnownApproval = keyof typeof APPROVAL_WORDS

export function affiliateApprovalLabel(approval: KnownApproval): string {
  return APPROVAL_WORDS[approval]
}

const REFUND_WORDS: Readonly<Record<number, string>> = {
  24: "24 hours",
  72: "3 days",
  168: "7 days",
  336: "14 days",
  720: "30 days",
}

/** The refund windows the form offers, as the hours the database stores. */
export const REFUND_WINDOW_OPTIONS = [24, 72, 168, 336, 720] as const

export function refundWindowLabel(hours: number): string {
  return REFUND_WORDS[hours] ?? `${hours} hours`
}

/**
 * Basis points as a percentage a person reads: 2000 becomes "20", 2250 becomes
 * "22.5". Integer arithmetic only.
 */
export function formatPercent(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new TypeError("formatPercent expects whole, non-negative basis points")
  }

  const whole = Math.floor(bps / 100)
  const remainder = bps % 100

  if (remainder === 0) {
    return `${whole}`
  }

  // 2250 basis points is 22.5%, not 22.50: trim the padding, not the value.
  const fraction = String(remainder).padStart(2, "0").replace(/0$/, "")

  return `${whole}.${fraction}`
}

/**
 * A whole percent typed into the form as basis points, or null when it is not a
 * whole number between 5 and 80. The form never sends a fraction.
 */
export function percentToBps(input: string): number | null {
  const trimmed = input.trim()

  if (!/^\d{1,2}$/.test(trimmed)) {
    return null
  }

  const percent = Number(trimmed)

  if (!Number.isInteger(percent) || percent < 5 || percent > 80) {
    return null
  }

  return percent * 100
}

/** Kobo as the string a price input starts with: 150000 becomes "1500". */
export function koboToNairaInput(kobo: number | null | undefined): string {
  if (kobo === null || kobo === undefined || !Number.isInteger(kobo)) {
    return ""
  }

  const amount = BigInt(kobo)
  const whole = amount / BigInt(100)
  const remainder = amount % BigInt(100)

  return remainder === BigInt(0)
    ? whole.toString()
    : `${whole.toString()}.${remainder.toString().padStart(2, "0")}`
}

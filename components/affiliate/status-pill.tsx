import {
  Archive,
  Ban,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Clock3,
  RotateCcw,
} from "lucide-react"

// A status is always a word and an icon, never a colour on its own. Colour is a
// second signal for people who can see it, and the badge still reads in
// grayscale, in a screenshot, and to a screen reader.

export type PillStatus =
  | "none"
  | "active"
  | "archived"
  | "pending"
  | "approved"
  | "rejected"
  | "blocked"
  | "paid"
  | "refunded"
  | "other"

const APPEARANCE: Record<PillStatus, { icon: typeof CircleCheck; className: string }> = {
  none: { icon: CircleDashed, className: "border-border bg-background text-muted-foreground" },
  active: { icon: CircleCheck, className: "border-brand-600 bg-brand-50 text-brand-800" },
  archived: { icon: Archive, className: "border-border bg-muted text-muted-foreground" },
  pending: { icon: Clock3, className: "border-border bg-background text-brand-ink" },
  approved: { icon: CircleCheck, className: "border-brand-600 bg-brand-50 text-brand-800" },
  rejected: { icon: CircleSlash, className: "border-border bg-background text-brand-ink" },
  blocked: { icon: Ban, className: "border-destructive/40 bg-background text-destructive" },
  paid: { icon: CircleCheck, className: "border-brand-600 bg-brand-50 text-brand-800" },
  refunded: { icon: RotateCcw, className: "border-border bg-background text-brand-ink" },
  other: { icon: CircleDashed, className: "border-border bg-background text-brand-ink" },
}

const WORDS: Record<PillStatus, string> = {
  none: "Not requested",
  active: "Active",
  archived: "Archived",
  pending: "Pending",
  approved: "Approved",
  rejected: "Declined",
  blocked: "Blocked",
  paid: "Paid",
  refunded: "Refunded",
  other: "Unknown",
}

/** The stored status, as one of the pills this app draws. */
export function pillStatus(value: string): PillStatus {
  return value in APPEARANCE ? (value as PillStatus) : "other"
}

export function StatusPill({ status, label }: { status: PillStatus; label?: string }) {
  const appearance = APPEARANCE[status]
  const Icon = appearance.icon

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${appearance.className}`}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {label ?? WORDS[status]}
    </span>
  )
}

/** An alert line, for a failed read. It is announced, not just drawn. */
export function ErrorNotice({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive"
    >
      <CircleAlert aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
      {message}
    </p>
  )
}

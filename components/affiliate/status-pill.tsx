import {
  Archive,
  Prohibit,
  CheckCircle,
  CircleDashed,
  ProhibitInset,
  Clock,
  ArrowCounterClockwise,
} from "@/components/ds/icons"

import { InlineAlert } from "@/components/ds/inline-alert"
import { StatusBadge, type StatusMap } from "@/components/ds/status-badge"

// A status is always a word and an icon, never a colour on its own. Colour is a
// second signal for people who can see it, and the badge still reads in
// grayscale, in a screenshot, and to a screen reader.
//
// The mapping is the design system's typed StatusMap, so a status added to the
// union without a word, a tone and an icon is a type error rather than a grey
// pill that says nothing.

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

/**
 * What each stored status looks like.
 *
 * The tone carries the meaning the word already says: waiting is warning, done is
 * success, stopped is danger, a reversal is information. The label is the word a
 * person reads; the description explains the status where there is room.
 */
const STATUS_MAP: StatusMap<PillStatus> = {
  none: {
    tone: "neutral",
    label: "Not requested",
    icon: CircleDashed,
    description: "No request has been made yet.",
  },
  active: {
    tone: "success",
    label: "Active",
    icon: CheckCircle,
    description: "Live and counting clicks.",
  },
  archived: {
    tone: "neutral",
    label: "Archived",
    icon: Archive,
    description: "Taken down, kept for the record.",
  },
  pending: {
    tone: "warning",
    label: "Pending",
    icon: Clock,
    description: "Waiting for someone to decide.",
  },
  approved: {
    tone: "success",
    label: "Approved",
    icon: CheckCircle,
    description: "Accepted.",
  },
  rejected: {
    tone: "neutral",
    label: "Declined",
    icon: ProhibitInset,
    description: "Declined. Nothing further happens.",
  },
  blocked: {
    tone: "danger",
    label: "Blocked",
    icon: Prohibit,
    description: "Stopped. The affiliate cannot promote this product.",
  },
  paid: {
    tone: "success",
    label: "Paid",
    icon: CheckCircle,
    description: "Money has been sent.",
  },
  refunded: {
    tone: "info",
    label: "Refunded",
    icon: ArrowCounterClockwise,
    description: "The order was refunded.",
  },
  other: {
    tone: "neutral",
    label: "Unknown",
    icon: CircleDashed,
    description: "A status this screen does not recognise.",
  },
}

/** The stored status, as one of the pills this app draws. */
export function pillStatus(value: string): PillStatus {
  return value in STATUS_MAP ? (value as PillStatus) : "other"
}

export function StatusPill({ status, label }: { status: PillStatus; label?: string }) {
  return <StatusBadge status={status} map={STATUS_MAP} label={label} size="md" />
}

/** An alert line, for a failed read. It is announced, not just drawn. */
export function ErrorNotice({ message }: { message: string }) {
  return <InlineAlert tone="danger">{message}</InlineAlert>
}

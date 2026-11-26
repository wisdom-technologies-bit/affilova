import {
  Archive,
  Ban,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Clock3,
  RotateCcw,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

// A status, as a word and an icon.
//
// The rule the whole product keeps: a status is never told by colour alone.
// Every badge here draws an icon and a label, so it reads in greyscale, in a
// screenshot, in a screen reader and to a person with colour blindness. The tone
// only changes the border and the pale background.
//
// The mapping is typed. A screen declares the statuses it can show as a
// Record<Status, StatusDescriptor>, so adding a status to a union without giving
// it a word and an icon is a type error rather than a grey pill that says
// nothing.

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info"

/** What one status looks like: a tone, a word and an icon. */
export interface StatusDescriptor {
  /** The tone. Colour is the third signal, after the icon and the word. */
  tone: StatusTone
  /** The word a person reads. Sentence case, short: "Paid", "On hold". */
  label: string
  /** The icon. Decorative: the label carries the meaning. */
  icon: LucideIcon
  /** A sentence explaining the status, for a title attribute or a doc row. */
  description?: string
}

/** Every status a screen can show, mapped to what it looks like. */
export type StatusMap<Status extends string> = Readonly<Record<Status, StatusDescriptor>>

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "border-border bg-background text-text-muted",
  success: "border-success/40 bg-success-subtle text-success",
  warning: "border-warning/40 bg-warning-subtle text-warning",
  danger: "border-danger/40 bg-danger-subtle text-danger",
  info: "border-info/40 bg-info-subtle text-info",
}

/** The descriptor used when a stored status is not in the map. */
export const UNKNOWN_STATUS: StatusDescriptor = {
  tone: "neutral",
  label: "Unknown",
  icon: CircleDashed,
  description: "A status this screen does not recognise.",
}

export interface StatusBadgeProps<Status extends string> {
  /** The stored status. */
  status: Status | string
  /** The mapping the screen declared for its own statuses. */
  map: StatusMap<Status>
  /** Overrides the label from the map, when the screen has a longer word. */
  label?: string
  /** Renders the pill in the small size, for a table row. */
  size?: "sm" | "md"
  className?: string
}

function descriptorFor<Status extends string>(
  status: Status | string,
  map: StatusMap<Status>,
): StatusDescriptor {
  const entries = Object.entries(map) as [string, StatusDescriptor][]
  const found = entries.find(([key]) => key === status)

  return found === undefined ? UNKNOWN_STATUS : found[1]
}

export function StatusBadge<Status extends string>({
  status,
  map,
  label,
  size = "sm",
  className,
}: StatusBadgeProps<Status>) {
  const descriptor = descriptorFor(status, map)
  const Icon = descriptor.icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-caption" : "px-2.5 py-1 text-small",
        TONE_CLASS[descriptor.tone],
        className,
      )}
      title={descriptor.description}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {label ?? descriptor.label}
    </span>
  )
}

// The icons the built-in maps use, re-exported so a screen can build its own map
// without importing from lucide-react twice.
export const STATUS_ICONS = {
  complete: CircleCheck,
  pending: Clock3,
  stopped: CircleSlash,
  blocked: Ban,
  reversed: RotateCcw,
  archived: Archive,
  unknown: CircleDashed,
} as const

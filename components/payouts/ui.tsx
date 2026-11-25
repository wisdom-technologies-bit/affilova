import {
  Ban,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Clock3,
  Hourglass,
  RotateCcw,
  Send,
  type LucideIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import { withdrawalStatusLabel } from "@/lib/payouts/format"

// Small pieces shared by the payout panels. Nothing here talks to the server.

export const BUTTON_PRIMARY =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"

export const BUTTON_SECONDARY =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"

export const BUTTON_DANGER =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-destructive/50 px-4 text-sm font-medium text-destructive transition-colors duration-150 hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"

export const INPUT_CLASS =
  "min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"

export function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-border p-4 md:p-6">
      <h2 className="text-lg font-semibold text-brand-ink">{title}</h2>
      {description === undefined ? null : <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** An error, announced to a screen reader. */
export function AlertLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
      <CircleAlert aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
      {children}
    </p>
  )
}

/** Good news or a neutral note, announced politely. */
export function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-md border border-brand-600/40 bg-brand-50 px-3 py-2 text-sm text-brand-ink">
      <CircleCheck aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
      {children}
    </p>
  )
}

/** A note that is not an error: a freeze, a blackout day. */
export function NoteBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-3 text-sm text-brand-ink">
      <p className="flex items-center gap-1.5 font-medium">
        <Hourglass aria-hidden="true" className="h-4 w-4" />
        {title}
      </p>
      <div className="mt-1 text-muted-foreground">{children}</div>
    </div>
  )
}

const STATUS_ICON: Readonly<Record<string, LucideIcon>> = {
  requested: Clock3,
  approved: CircleCheck,
  processing: Send,
  paid: CircleCheck,
  failed: Ban,
  reversed: RotateCcw,
  rejected: CircleSlash,
  cancelled: CircleSlash,
}

const STATUS_CLASS: Readonly<Record<string, string>> = {
  paid: "border-brand-600 bg-brand-50 text-brand-800",
  failed: "border-destructive/40 bg-background text-destructive",
  reversed: "border-destructive/40 bg-background text-destructive",
}

/** A withdrawal status as an icon and a word, never a colour alone. */
export function WithdrawalStatusBadge({ status }: { status: string }) {
  const Icon = STATUS_ICON[status] ?? CircleAlert
  const tone = STATUS_CLASS[status] ?? "border-border bg-background text-brand-ink"

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}>
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {withdrawalStatusLabel(status)}
    </span>
  )
}

import {
  WarningCircle,
  CheckCircle,
  Clock,
  ProhibitInset,
  Prohibit,
  Hourglass,
  ArrowCounterClockwise,
  PaperPlaneTilt,
  type IconComponent,
} from "@/components/ds/icons"
import type { ReactNode } from "react"

import { InlineAlert } from "@/components/ds/inline-alert"
import { Section as DsSection } from "@/components/ds/section"
import { StatusBadge, type StatusMap } from "@/components/ds/status-badge"
import { buttonVariants } from "@/components/ui/button"
import { withdrawalStatusLabel } from "@/lib/payouts/format"

// Small pieces shared by the payout panels. Nothing here talks to the server.
//
// Every one of them is the design system's version, kept under the name the
// payout panels already import. A button is the primitive's own class set, so a
// primary action in a payout panel is the same green, the same height and the
// same focus ring as a primary action anywhere else.

/** The primary action: brand-600, white label, 44px. */
export const BUTTON_PRIMARY = buttonVariants({ variant: "default" })

/** A secondary action: a 3:1 border on white. */
export const BUTTON_SECONDARY = buttonVariants({ variant: "outline" })

/** A destructive action: a danger border and label, on white. */
export const BUTTON_DANGER = `${buttonVariants({ variant: "outline" })} border-danger/60 text-danger hover:bg-danger-subtle`

/** The shared input: 44px, a 3:1 edge, the system focus ring. */
export const INPUT_CLASS =
  "focus-ring h-control-md w-full rounded-md border border-border-control bg-background px-3 text-dense text-foreground transition-colors duration-150 placeholder:text-text-subtle disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-subtle aria-[invalid=true]:border-danger"

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
    <DsSection title={title} description={description}>
      {children}
    </DsSection>
  )
}

/** An error, announced to a screen reader. */
export function AlertLine({ children }: { children: ReactNode }) {
  return <InlineAlert tone="danger">{children}</InlineAlert>
}

/** Good news or a neutral note, announced politely. */
export function StatusLine({ children }: { children: ReactNode }) {
  return <InlineAlert tone="success">{children}</InlineAlert>
}

/** A note that is not an error: a freeze, a blackout day. */
export function NoteBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <InlineAlert tone="info" title={title}>
      <Hourglass aria-hidden="true" size="sm" className="mr-1.5 inline align-text-bottom" />
      {children}
    </InlineAlert>
  )
}

/**
 * A withdrawal status as an icon and a word, never a colour alone.
 *
 * The tone is the design system's, so a paid payout and a paid order are the same
 * green, and a failed transfer and a failed payment are the same red.
 */
const STATUS_MAP: Readonly<Record<string, { tone: "neutral" | "success" | "warning" | "danger" | "info"; icon: IconComponent }>> = {
  requested: { tone: "warning", icon: Clock },
  approved: { tone: "info", icon: CheckCircle },
  processing: { tone: "info", icon: PaperPlaneTilt },
  paid: { tone: "success", icon: CheckCircle },
  failed: { tone: "danger", icon: Prohibit },
  reversed: { tone: "danger", icon: ArrowCounterClockwise },
  rejected: { tone: "neutral", icon: ProhibitInset },
  cancelled: { tone: "neutral", icon: ProhibitInset },
}

export function WithdrawalStatusBadge({ status }: { status: string }) {
  const entry = STATUS_MAP[status] ?? { tone: "neutral" as const, icon: WarningCircle }

  const map: StatusMap<string> = {
    [status]: {
      tone: entry.tone,
      icon: entry.icon,
      label: withdrawalStatusLabel(status),
    },
  }

  return <StatusBadge status={status} map={map} size="md" />
}

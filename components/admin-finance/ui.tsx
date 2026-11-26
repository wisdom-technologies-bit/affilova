import Link from "next/link"
import type { ReactNode } from "react"

import { formatNaira } from "@/lib/catalog/money"

// The pieces every admin finance screen uses.
//
// Two rules run through all of them: a status is never told by colour alone (it
// has a word and, where it matters, an icon), and every live region that can
// change while a person looks at it is announced.

export const BUTTON_PRIMARY =
  "focus-ring inline-flex h-control-md items-center justify-center rounded-md bg-brand-600 px-4 text-dense font-medium text-background transition-colors duration-150 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"

export const BUTTON_SECONDARY =
  "focus-ring inline-flex h-control-md items-center justify-center rounded-md border border-border-control bg-background px-4 text-dense font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"

export const BUTTON_DANGER =
  "focus-ring inline-flex h-control-md items-center justify-center rounded-md border border-danger/60 bg-background px-4 text-dense font-medium text-danger transition-colors duration-150 hover:bg-danger-subtle disabled:cursor-not-allowed disabled:opacity-60"

export const INPUT_CLASS =
  "focus-ring h-control-md w-full rounded-md border border-border-control bg-background px-3 text-dense text-foreground transition-colors duration-150 placeholder:text-text-subtle"

export const LABEL_CLASS = "block text-dense font-medium text-foreground"

export function Money({ kobo }: { kobo: bigint }) {
  return <span className="tabular-nums">{formatNaira(kobo)}</span>
}

export type Tone = "neutral" | "positive" | "warning" | "danger"

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-border bg-surface-muted text-foreground",
  positive: "border-success/40 bg-success-subtle text-success",
  warning: "border-warning/40 bg-warning-subtle text-warning",
  danger: "border-danger/40 bg-danger-subtle text-danger",
}

/**
 * A status, as a word. The tone changes the border and the background, and the
 * word carries the meaning: a person who cannot tell amber from grey still reads
 * "Overdue".
 */
export function StatusTag({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-semibold ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  )
}

export function Section({
  title,
  description,
  children,
  actions,
}: {
  title: string
  description?: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="rounded-md border border-border bg-background p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {description === undefined ? null : (
            <p className="mt-1 text-dense text-text-muted">{description}</p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

/** A line that is announced when it appears, never colour only. */
export function AlertLine({ message }: { message: string }) {
  return (
    <p role="alert" aria-live="polite" className="text-dense font-medium text-danger">
      {message}
    </p>
  )
}

export function QuietLine({ children }: { children: ReactNode }) {
  return <p className="text-dense text-text-muted">{children}</p>
}

/** An honest empty state: it says what would appear here, not "no data". */
export function EmptyBlock({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
      <p className="text-dense font-medium text-foreground">{title}</p>
      {hint === undefined ? null : <p className="mt-1 text-dense text-text-muted">{hint}</p>}
    </div>
  )
}

/** The "Loading" line, for a region that is waiting on a server action. */
export function LoadingLine({ label }: { label: string }) {
  return (
    <p role="status" aria-live="polite" className="text-dense text-text-muted">
      {label}
    </p>
  )
}

export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={BUTTON_SECONDARY}>
      {children}
    </Link>
  )
}

/** A definition row: a label and a value, used in the detail pages. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-0">
      <dt className="text-dense text-text-muted">{label}</dt>
      <dd className="text-dense font-medium text-foreground">{children}</dd>
    </div>
  )
}

export function DetailList({ children }: { children: ReactNode }) {
  return <dl className="rounded-md border border-border px-3">{children}</dl>
}

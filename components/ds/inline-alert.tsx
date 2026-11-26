import {
  WarningCircle,
  CheckCircle,
  Info,
  Warning,
  type IconComponent,
} from "@/components/ds/icons"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// A message about the state of the page, inline where the problem is.
//
// Four tones, each with an icon, a word and a role:
//   * info and success are polite (`role="status"`): the page did something and
//     says so without interrupting;
//   * warning and danger are assertive (`role="alert"`): something needs a
//     decision, or something failed.
//
// The icon is what carries the tone for a person who cannot see the colour, and
// the sentence itself says what happened. Colour is the third signal, never the
// first.

export type AlertTone = "info" | "success" | "warning" | "danger"

const TONE: Record<AlertTone, { icon: IconComponent; className: string; role: "status" | "alert" }> = {
  info: { icon: Info, className: "border-info/40 bg-info-subtle text-info", role: "status" },
  success: {
    icon: CheckCircle,
    className: "border-success/40 bg-success-subtle text-success",
    role: "status",
  },
  warning: {
    icon: Warning,
    className: "border-warning/40 bg-warning-subtle text-warning",
    role: "alert",
  },
  danger: { icon: WarningCircle, className: "border-danger/40 bg-danger-subtle text-danger", role: "alert" },
}

export interface InlineAlertProps {
  tone: AlertTone
  /** The message. One or two sentences, sentence case, specific. */
  children: ReactNode
  /** A short bold lead-in, such as "Payout on hold". */
  title?: string
  /** An action that resolves the problem, such as "Add a bank account". */
  action?: ReactNode
  className?: string
}

export function InlineAlert({ tone, children, title, action, className }: InlineAlertProps) {
  const { icon: Icon, className: toneClass, role } = TONE[tone]

  return (
    <div
      role={role}
      className={cn("flex items-start gap-2 rounded-md border px-3 py-2.5 text-dense", toneClass, className)}
    >
      <Icon aria-hidden="true" size="sm" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title === undefined ? null : <p className="font-medium">{title}</p>}
        <div className={title === undefined ? undefined : "mt-0.5 opacity-90"}>{children}</div>
        {action === undefined ? null : <div className="mt-2">{action}</div>}
      </div>
    </div>
  )
}

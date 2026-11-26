import { CircleAlert } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// A label, a control, a helper line and an error, wired together.
//
// The point of this component is the wiring: the label is tied to the control by
// id, the help and the error are joined into one aria-describedby, and the error
// also sets aria-invalid. A screen reader therefore reads the field as "Amount,
// invalid, entry, In naira. The amount is below the minimum." rather than
// announcing a label with no relationship to its input.
//
// The control is given to the component as a function, so it can pass the ids
// down without the caller repeating them:
//
//   <Field label="Amount" help="In naira" error={error} required>
//     {(field) => <Input {...field} inputMode="numeric" />}
//   </Field>
//
// A plain child also works when the caller wires aria-describedby itself.

/** The attributes Field has prepared for its control. Spread them onto it. */
export interface FieldControlProps {
  id: string
  "aria-describedby": string | undefined
  "aria-invalid": true | undefined
  "aria-required": true | undefined
}

export interface FieldProps {
  /** The visible label. Sentence case, no colon. */
  label: string
  /** The control's id, and the base of the help and error ids. */
  id: string
  /** One line under the control: a format, a limit, where the value comes from. */
  help?: string
  /** The validation message. Presence means the field is invalid. */
  error?: string
  /** Adds the required marker and aria-required. */
  required?: boolean
  /** A control (input, select, textarea) or a function that receives the ids. */
  children: ReactNode | ((field: FieldControlProps) => ReactNode)
  /** Marks the label as visually hidden while keeping it for screen readers. */
  hideLabel?: boolean
  className?: string
}

export function Field({
  label,
  id,
  help,
  error,
  required = false,
  children,
  hideLabel = false,
  className,
}: FieldProps) {
  const helpId = help === undefined ? undefined : `${id}-help`
  const errorId = error === undefined ? undefined : `${id}-error`
  const describedBy = [helpId, errorId].filter((value): value is string => value !== undefined).join(" ")

  const field: FieldControlProps = {
    id,
    "aria-describedby": describedBy === "" ? undefined : describedBy,
    "aria-invalid": error === undefined ? undefined : true,
    "aria-required": required ? true : undefined,
  }

  return (
    <div className={cn("min-w-0", className)}>
      <label
        htmlFor={id}
        className={cn(
          "block text-small font-medium text-foreground",
          hideLabel ? "sr-only" : undefined,
        )}
      >
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="ml-1 text-danger">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </label>

      <div className={hideLabel ? undefined : "mt-1.5"}>
        {typeof children === "function" ? children(field) : children}
      </div>

      {help === undefined ? null : (
        <p id={helpId} className="mt-1.5 text-small text-text-subtle">
          {help}
        </p>
      )}

      {error === undefined ? null : (
        <p id={errorId} className="mt-1.5 flex items-start gap-1 text-small text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

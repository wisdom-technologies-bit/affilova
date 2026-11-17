import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react"

// One labelled control, with its hint and its error.
//
// The ids are derived from the control's own id, so a screen reader reads the
// label, then the hint, then the error, and a test can point at either without
// the caller inventing names.

export function hintId(controlId: string): string {
  return `${controlId}-hint`
}

export function errorId(controlId: string): string {
  return `${controlId}-error`
}

/** The aria-describedby value for a control inside a FormField. */
export function describedBy(controlId: string): string {
  return `${hintId(controlId)} ${errorId(controlId)}`
}

/**
 * The control inside a required field, marked required for assistive technology.
 *
 * The asterisk beside the label is decoration; this is the part a screen reader
 * announces. aria-required rather than required: the forms validate on submit
 * and show their own messages, and a native bubble would speak over them.
 */
function markRequired(node: ReactNode): ReactNode {
  if (!isValidElement(node)) {
    return node
  }

  return cloneElement(node as ReactElement<{ "aria-required"?: boolean }>, { "aria-required": true })
}

export function FormField({
  id,
  label,
  hint,
  error,
  required = false,
  children,
}: {
  id: string
  label: string
  hint?: ReactNode
  error?: string | null
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-brand-ink">
        {label}
        {required ? (
          <span className="ml-1 text-muted-foreground" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      {required ? markRequired(children) : children}

      {hint === undefined ? null : (
        <p id={hintId(id)} className="text-xs leading-5 text-muted-foreground">
          {hint}
        </p>
      )}

      {/* Always present, so an error is announced the moment it appears. */}
      <p id={errorId(id)} aria-live="polite" className="text-xs font-medium text-destructive">
        {error ?? ""}
      </p>
    </div>
  )
}

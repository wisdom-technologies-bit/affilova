import type { InputHTMLAttributes, ReactNode } from "react"

import { Field } from "@/components/ds/field"
import { Input } from "@/components/ui/input"

// A labelled text input with optional helper text, an inline error and an
// optional control on the right (used by the password field for show/hide).
// autocomplete, inputMode, name and every other input attribute come from the
// caller, so each field states its own purpose explicitly.
//
// It is a thin wrapper over the design system's Field, which owns the wiring:
// the label is tied to the input by id, the hint and the error are joined into
// one aria-describedby, and an error sets aria-invalid. The props here are the
// ones the auth forms already use, so no caller changed.

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className"> {
  id: string
  label: string
  hint?: string
  error?: string
  trailing?: ReactNode
  className?: string
}

export function TextField({ id, label, hint, error, trailing, className, ...props }: TextFieldProps) {
  return (
    <Field
      id={id}
      label={label}
      help={hint}
      error={error}
      required={props.required === true}
      className={className}
    >
      {(field) => (
        <div className="relative">
          <Input {...props} {...field} className={trailing === undefined ? undefined : "pr-12"} />

          {trailing === undefined ? null : (
            <div className="absolute inset-y-0 right-0 flex items-center pr-1">{trailing}</div>
          )}
        </div>
      )}
    </Field>
  )
}

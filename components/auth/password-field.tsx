"use client"

import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"

import { TextField, type TextFieldProps } from "./text-field"

// A text field that starts as a password input and can be revealed. The toggle
// is a real button with a 44px target, aria-pressed and a visible focus ring,
// and the input keeps its own label and autocomplete value.

export type PasswordFieldProps = Omit<TextFieldProps, "type" | "trailing">

export function PasswordField({ id, ...props }: PasswordFieldProps) {
  const [shown, setShown] = useState(false)

  return (
    <TextField
      {...props}
      id={id}
      type={shown ? "text" : "password"}
      trailing={
        <button
          type="button"
          aria-pressed={shown}
          aria-controls={id}
          onClick={() => setShown((current) => !current)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          {shown ? (
            <EyeOff aria-hidden="true" className="size-4" />
          ) : (
            <Eye aria-hidden="true" className="size-4" />
          )}
          <span className="sr-only">{shown ? "Hide password" : "Show password"}</span>
        </button>
      }
    />
  )
}

"use client"

import { useState } from "react"
import {
  Eye,
  EyeSlash,
} from "@/components/ds/icons"

import { TextField, type TextFieldProps } from "./text-field"

// A text field that starts as a password input and can be revealed. The toggle
// is a real button with a 44px target, aria-pressed and the system focus ring,
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
          className="focus-ring inline-flex h-control-md w-control-md items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
        >
          {shown ? (
            <EyeSlash aria-hidden="true" size="sm" />
          ) : (
            <Eye aria-hidden="true" size="sm" />
          )}
          <span className="sr-only">{shown ? "Hide password" : "Show password"}</span>
        </button>
      }
    />
  )
}

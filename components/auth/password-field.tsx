"use client"

import { useState, type KeyboardEvent } from "react"

import { Eye, EyeSlash } from "@/components/ds/icons"
import { passwordStrength } from "@/lib/identity/password-strength"

import { TextField, type TextFieldProps } from "./text-field"

// A text field that starts as a password input and can be revealed.
//
// Three things this field adds to a plain input, all of them about not being
// surprised by what you cannot see:
//
//  * a show/hide toggle that is a real button with a 44px target, aria-pressed
//    and the system focus ring, and a label a screen reader can read;
//  * a Caps Lock hint, because a password that looks wrong is usually a password
//    typed in capitals, and the browser will not tell you;
//  * on sign-up and reset, a guidance line whose strength word is based on length
//    and is written in words, never a colour or a bar. The word never blocks a
//    password the server would accept.
//
// The input keeps its own label and autocomplete value: nothing here changes what
// the browser or the password manager sees.

export type PasswordFieldProps = Omit<TextFieldProps, "type" | "trailing"> & {
  /** Shows the length-based guidance line under the field. */
  showStrength?: boolean
}

export function PasswordField({ id, showStrength = false, hint, onKeyDown, onKeyUp, onBlur, value, ...props }: PasswordFieldProps) {
  const [shown, setShown] = useState(false)
  const [capsLock, setCapsLock] = useState(false)

  const length = typeof value === "string" ? value.length : 0
  const strength = passwordStrength(length)

  function readCapsLock(event: KeyboardEvent<HTMLInputElement>): void {
    if (typeof event.getModifierState === "function") {
      setCapsLock(event.getModifierState("CapsLock"))
    }
  }

  return (
    <div>
      <TextField
        {...props}
        id={id}
        hint={hint}
        value={value}
        type={shown ? "text" : "password"}
        onKeyDown={(event) => {
          readCapsLock(event)
          onKeyDown?.(event)
        }}
        onKeyUp={(event) => {
          readCapsLock(event)
          onKeyUp?.(event)
        }}
        onBlur={(event) => {
          setCapsLock(false)
          onBlur?.(event)
        }}
        trailing={
          <button
            type="button"
            aria-pressed={shown}
            aria-controls={id}
            onClick={() => setShown((current) => !current)}
            className="focus-ring inline-flex h-control-md w-control-md items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
          >
            {shown ? <EyeSlash size="sm" /> : <Eye size="sm" />}
            <span className="sr-only">{shown ? "Hide password" : "Show password"}</span>
          </button>
        }
      />

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {showStrength ? (
          <p className="text-small text-text-subtle" aria-live="polite">
            {length === 0 ? (
              "Strength: not entered yet"
            ) : (
              <>
                Strength: <span className="font-medium text-foreground">{strength.label}</span>
              </>
            )}
          </p>
        ) : null}

        {capsLock ? (
          <p className="text-small text-warning" aria-live="polite">
            Caps Lock is on
          </p>
        ) : null}
      </div>
    </div>
  )
}

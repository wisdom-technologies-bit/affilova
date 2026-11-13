"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  TURNSTILE_SCRIPT_ID,
  TURNSTILE_SCRIPT_URL,
  buildTurnstileOptions,
  type TurnstileOptions,
} from "@/lib/identity/turnstile"

// Cloudflare Turnstile, rendered explicitly.
//
// Lifecycle: the API script is loaded once per page (one tag, guarded by id),
// then turnstile.render() is given our container and the options built in
// lib/identity/turnstile.ts plus the three callbacks the forms care about. The
// widget id is kept so the widget can be reset and removed.
//
// A token is single use, so the form must reset the widget after every
// submission attempt, successful or not: it bumps resetSignal and clears its
// stored token. This component only resets the widget; the token is owned by
// the form.
//
// The token is handed to a server action as captchaToken and verified by
// Supabase with the secret kept in the Supabase dashboard. This app never calls
// siteverify and never verifies the token itself, because a token can only be
// redeemed once.

type TurnstileCallbacks = {
  callback: (token: string) => void
  "expired-callback": () => void
  "timeout-callback": () => void
  "error-callback": (code: string) => void
}

type TurnstileRenderOptions = TurnstileOptions & TurnstileCallbacks

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string | undefined
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
}

// The Cloudflare script attaches window.turnstile. The value is read through a
// narrow runtime check rather than a global declaration, because the legacy
// login page already declares the same property differently and that file is
// out of scope here.
function readTurnstileApi(): TurnstileApi | undefined {
  if (typeof window === "undefined") {
    return undefined
  }

  const candidate: unknown = (window as unknown as Record<string, unknown>).turnstile

  if (typeof candidate !== "object" || candidate === null) {
    return undefined
  }

  const render: unknown = (candidate as { render?: unknown }).render

  if (typeof render !== "function") {
    return undefined
  }

  return candidate as unknown as TurnstileApi
}

export const VERIFICATION_UNAVAILABLE_MESSAGE =
  "Verification is unavailable on this address. Please use the official site."

// One module-level promise: several widgets on a page, and later mounts too,
// share the same script and never append a second tag.
let scriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve()
  }

  if (readTurnstileApi()) {
    return Promise.resolve()
  }

  if (scriptPromise) {
    return scriptPromise
  }

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(TURNSTILE_SCRIPT_ID)

    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true })
      existing.addEventListener("error", () => reject(new Error("turnstile script")), {
        once: true,
      })
      return
    }

    const script = document.createElement("script")
    script.id = TURNSTILE_SCRIPT_ID
    script.src = TURNSTILE_SCRIPT_URL
    script.async = true
    script.defer = true
    script.addEventListener("load", () => resolve(), { once: true })
    script.addEventListener("error", () => reject(new Error("turnstile script")), {
      once: true,
    })
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    // Let a later mount try again rather than caching the failure forever.
    scriptPromise = null
    throw error
  })

  return scriptPromise
}

export interface TurnstileProps {
  /** Turnstile action name, e.g. sign_in, sign_up or forgot_password. */
  action: string
  onToken: (token: string) => void
  onExpire: () => void
  onError: () => void
  /** Bump this after every submission attempt to reset the widget. */
  resetSignal?: number
}

export function Turnstile({ action, onToken, onExpire, onError, resetSignal = 0 }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | undefined>(undefined)
  const callbacksRef = useRef({ onToken, onExpire, onError })
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    callbacksRef.current = { onToken, onExpire, onError }
  })

  const fail = useCallback(() => {
    setFailed(true)
    callbacksRef.current.onError()
  }, [])

  useEffect(() => {
    let cancelled = false

    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

    if (siteKey === undefined || siteKey.trim() === "") {
      fail()
      return
    }

    let options: TurnstileOptions

    try {
      options = buildTurnstileOptions(action, siteKey)
    } catch {
      fail()
      return
    }

    loadTurnstileScript()
      .then(() => {
        const api = readTurnstileApi()
        const container = containerRef.current

        if (cancelled || !api || !container) {
          return
        }

        widgetIdRef.current = api.render(container, {
          ...options,
          callback: (token: string) => {
            callbacksRef.current.onToken(token)
          },
          "expired-callback": () => {
            callbacksRef.current.onExpire()
          },
          "timeout-callback": () => {
            callbacksRef.current.onExpire()
          },
          "error-callback": () => {
            fail()
          },
        })
      })
      .catch(() => {
        if (!cancelled) {
          fail()
        }
      })

    return () => {
      cancelled = true

      const api = readTurnstileApi()
      const widgetId = widgetIdRef.current

      widgetIdRef.current = undefined

      if (api && widgetId !== undefined) {
        api.remove(widgetId)
      }
    }
  }, [action, fail])

  useEffect(() => {
    if (resetSignal === 0) {
      return
    }

    const api = readTurnstileApi()
    const widgetId = widgetIdRef.current

    if (api && widgetId !== undefined) {
      api.reset(widgetId)
    }
  }, [resetSignal])

  if (failed) {
    return (
      <p
        role="status"
        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
      >
        {VERIFICATION_UNAVAILABLE_MESSAGE}
      </p>
    )
  }

  return <div ref={containerRef} />
}

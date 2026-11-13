// Pure Cloudflare Turnstile logic, shared by the client widget and its tests.
//
// Nothing here touches window, document or the network, so it can be imported
// from a unit test in a plain Node environment. The widget component
// (components/auth/turnstile.tsx) owns the script, the container and the
// callbacks; this file only decides whether an action name is acceptable and
// what options object the widget is rendered with.
//
// The token a widget produces is single use and is verified by Supabase, not by
// this app: it is passed to a server action as captchaToken and Supabase
// redeems it with the secret stored in the Supabase dashboard. The browser
// never calls siteverify, and no secret is present anywhere in this app for
// these flows.

export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

export const TURNSTILE_SCRIPT_ID = "cf-turnstile-script"

// Cloudflare accepts an action of 1 to 32 characters made of letters, numbers,
// underscores and hyphens. Anything else is rejected by the widget.
const ACTION_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

export type TurnstileAction = "sign_in" | "sign_up" | "forgot_password"

export type TurnstileOptions = {
  sitekey: string
  action: string
  theme: "light"
  size: "flexible"
  language: "auto"
  retry: "auto"
  "refresh-expired": "auto"
}

export function isValidTurnstileAction(action: string): boolean {
  return ACTION_PATTERN.test(action)
}

/**
 * The options object passed to turnstile.render(). The widget adds the
 * callbacks itself, so this stays a plain, comparable value.
 *
 * Throws rather than sending an invalid action to Cloudflare: the caller
 * (the widget component) checks the arguments it can see first and shows a
 * plain message when the site key is missing.
 */
export function buildTurnstileOptions(action: string, siteKey: string): TurnstileOptions {
  if (!isValidTurnstileAction(action)) {
    throw new TypeError(
      "buildTurnstileOptions: action must be 1 to 32 characters of letters, numbers, underscore or hyphen",
    )
  }

  const trimmedSiteKey = siteKey.trim()

  if (trimmedSiteKey === "") {
    throw new TypeError("buildTurnstileOptions: a site key is required")
  }

  return {
    sitekey: trimmedSiteKey,
    action,
    theme: "light",
    size: "flexible",
    language: "auto",
    retry: "auto",
    "refresh-expired": "auto",
  }
}

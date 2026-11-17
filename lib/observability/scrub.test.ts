import { describe, expect, it } from "vitest"

import type { Event } from "@sentry/nextjs"

import {
  NO_PII_DATA_COLLECTION,
  isNoiseEvent,
  maskEmail,
  scrubEvent,
  tracesSampleRateFor,
} from "./scrub"

function eventOf(partial: Partial<Event>): Event {
  return { event_id: "abc", ...partial }
}

describe("tracesSampleRateFor", () => {
  it("samples 10% in production and nothing anywhere else", () => {
    expect(tracesSampleRateFor("production")).toBe(0.1)
    expect(tracesSampleRateFor("preview")).toBe(0)
    expect(tracesSampleRateFor("development")).toBe(0)
    expect(tracesSampleRateFor(undefined)).toBe(0)
  })

  it("collects no personal data by default", () => {
    // The v11 replacement for `sendDefaultPii: false`. See the comment on the
    // constant: the option itself was removed from the SDK.
    expect(NO_PII_DATA_COLLECTION).toEqual({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    })
  })
})

describe("maskEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("ada@example.com")).toBe("a***@example.com")
    expect(maskEmail("ada.lovelace@mail.example.co.uk")).toBe("a***@mail.example.co.uk")
  })

  it("masks every address inside a sentence", () => {
    expect(maskEmail("invite bob@example.com and eve@test.io now")).toBe(
      "invite b***@example.com and e***@test.io now",
    )
  })

  it("leaves text without an address alone", () => {
    expect(maskEmail("rate-limit: lookup failed")).toBe("rate-limit: lookup failed")
  })
})

describe("scrubEvent", () => {
  it("removes cookies, authorization, set-cookie, key and token headers", () => {
    const event = eventOf({
      request: {
        url: "https://affilova.example/api/x",
        method: "POST",
        cookies: { session: "secret-cookie-value" },
        headers: {
          cookie: "auth-token=abc",
          "set-cookie": "auth-token=abc",
          authorization: "Bearer abc",
          "x-api-key": "key-value",
          "x-csrf-token": "token-value",
          "x-forwarded-for": "203.0.113.7",
          "content-type": "application/json",
        },
      },
    })

    const scrubbed = scrubEvent(event)

    expect(scrubbed?.request?.cookies).toBeUndefined()
    expect(scrubbed?.request?.headers).toEqual({
      "x-forwarded-for": "203.0.113.7",
      "content-type": "application/json",
    })
  })

  it("removes the request body", () => {
    const scrubbed = scrubEvent(
      eventOf({
        request: { url: "https://affilova.example/api/sign-in", data: { password: "hunter2" } },
      }),
    )

    expect(scrubbed?.request?.data).toBeUndefined()
  })

  it("masks emails in the message and in nested extra data", () => {
    const scrubbed = scrubEvent(
      eventOf({
        message: "Sign-in failed for ada@example.com",
        extra: {
          buyer: "bob@example.com",
          nested: {
            deeper: ["eve@test.io", { owner: "sam@example.org", count: 3 }],
          },
          untouched: 42,
        },
      }),
    )

    expect(scrubbed?.message).toBe("Sign-in failed for a***@example.com")
    expect(scrubbed?.extra).toEqual({
      buyer: "b***@example.com",
      nested: {
        deeper: ["e***@test.io", { owner: "s***@example.org", count: 3 }],
      },
      untouched: 42,
    })
  })

  it("leaves fields it was not asked about exactly as they were", () => {
    const event = eventOf({
      message: "boom",
      level: "error",
      platform: "javascript",
      transaction: "/checkout",
      tags: { route: "/checkout" },
      user: { id: "user_1" },
      extra: { amountKobo: 250000 },
      fingerprint: ["checkout"],
    })

    const scrubbed = scrubEvent(event)

    expect(scrubbed?.level).toBe("error")
    expect(scrubbed?.platform).toBe("javascript")
    expect(scrubbed?.transaction).toBe("/checkout")
    expect(scrubbed?.tags).toEqual({ route: "/checkout" })
    expect(scrubbed?.user).toEqual({ id: "user_1" })
    expect(scrubbed?.extra).toEqual({ amountKobo: 250000 })
    expect(scrubbed?.fingerprint).toEqual(["checkout"])
  })

  it("does not mutate the event it was given", () => {
    const event = eventOf({
      message: "ada@example.com",
      request: { cookies: { session: "abc" }, data: "body" },
      extra: { email: "bob@example.com" },
    })

    scrubEvent(event)

    expect(event.message).toBe("ada@example.com")
    expect(event.request?.cookies).toEqual({ session: "abc" })
    expect(event.request?.data).toBe("body")
    expect(event.extra).toEqual({ email: "bob@example.com" })
  })

  it("handles a circular extra payload", () => {
    const circular: Record<string, unknown> = { email: "ada@example.com" }
    circular.self = circular

    const scrubbed = scrubEvent(eventOf({ extra: circular }))

    expect(scrubbed?.extra?.email).toBe("a***@example.com")
    expect(scrubbed?.extra?.self).toBe("[circular]")
  })
})

describe("noise filtering", () => {
  it("drops a ResizeObserver loop message", () => {
    expect(
      scrubEvent(
        eventOf({ message: "ResizeObserver loop completed with undelivered notifications." }),
      ),
    ).toBeNull()

    expect(scrubEvent(eventOf({ message: "ResizeObserver loop limit exceeded" }))).toBeNull()
  })

  it("drops browser extension URLs", () => {
    expect(
      scrubEvent(eventOf({ message: "chrome-extension://abcdef/content.js failed" })),
    ).toBeNull()

    expect(
      scrubEvent(
        eventOf({ request: { url: "moz-extension://1234-5678/page.html" } }),
      ),
    ).toBeNull()
  })

  it("drops Turnstile script errors", () => {
    expect(
      scrubEvent(
        eventOf({
          message: "Script error.",
          exception: {
            values: [
              {
                type: "Error",
                value: "Script error.",
                stacktrace: {
                  frames: [{ filename: "https://challenges.cloudflare.com/turnstile/v0/api.js" }],
                },
              },
            ],
          },
        }),
      ),
    ).toBeNull()

    expect(
      scrubEvent(eventOf({ message: "Turnstile script error while loading the widget" })),
    ).toBeNull()
  })

  it("keeps an ordinary event", () => {
    expect(
      scrubEvent(
        eventOf({
          message: "rate_limit_lookup_failed",
          request: { url: "https://affilova.example/api/cron/process-queue" },
        }),
      ),
    ).not.toBeNull()
  })

  it("isNoiseEvent sees the same facts", () => {
    expect(isNoiseEvent(eventOf({ message: "ResizeObserver loop limit exceeded" }))).toBe(true)
    expect(isNoiseEvent(eventOf({ message: "boom" }))).toBe(false)
  })
})

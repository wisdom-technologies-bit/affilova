import { describe, expect, it } from "vitest"

import { getEmailConfigHealth, type ApiKeyKind, type FromDomainKind } from "./health"

// The health check is a pure function of five variables, so every combination is
// tested: four kinds of key, four kinds of sender, and the three optional
// settings each present or absent. A hundred and twenty-eight cases, generated
// rather than typed, and each one asserts the whole answer.
//
// The second rule this file proves is the one that matters most on an admin
// screen: the answer never contains a value.

const SECRET = "s".repeat(40)

const API_KEYS: Readonly<Record<ApiKeyKind, string | undefined>> = {
  api: "xkeysib-0123456789abcdef0123456789abcdef",
  smtp: "xsmtpsib-0123456789abcdef0123456789abcdef",
  unknown: "some-other-key",
  missing: undefined,
}

const FROM_ADDRESSES: Readonly<Record<FromDomainKind, string | undefined>> = {
  own: "no-reply@affilova.com",
  free_mail: "no-reply@gmail.com",
  invalid: "not-an-address",
  missing: undefined,
}

/** One problem per wrong key kind and one per wrong sender kind. */
function keyProblemCount(kind: ApiKeyKind): number {
  return kind === "api" ? 0 : 1
}

function fromProblemCount(kind: FromDomainKind): number {
  return kind === "own" ? 0 : 1
}

const API_KEY_KINDS: readonly ApiKeyKind[] = ["api", "smtp", "unknown", "missing"]
const FROM_KINDS: readonly FromDomainKind[] = ["own", "free_mail", "invalid", "missing"]
const PRESENT = [true, false] as const

describe("getEmailConfigHealth", () => {
  const combinations = API_KEY_KINDS.flatMap((apiKeyKind) =>
    FROM_KINDS.flatMap((fromDomainKind) =>
      PRESENT.flatMap((replyTo) =>
        PRESENT.flatMap((orderSecret) =>
          PRESENT.map((stepUpSecret) => ({
            apiKeyKind,
            fromDomainKind,
            replyTo,
            orderSecret,
            stepUpSecret,
          })),
        ),
      ),
    ),
  )

  it("covers every combination", () => {
    expect(combinations).toHaveLength(4 * 4 * 2 * 2 * 2)
  })

  it.each(combinations)(
    "reports $apiKeyKind key, $fromDomainKind sender, replyTo $replyTo, secrets $orderSecret/$stepUpSecret",
    ({ apiKeyKind, fromDomainKind, replyTo, orderSecret, stepUpSecret }) => {
      const health = getEmailConfigHealth({
        BREVO_API_KEY: API_KEYS[apiKeyKind],
        EMAIL_FROM: FROM_ADDRESSES[fromDomainKind],
        EMAIL_REPLY_TO: replyTo ? "support@affilova.com" : undefined,
        ORDER_ACCESS_SECRET: orderSecret ? SECRET : undefined,
        STEP_UP_SECRET: stepUpSecret ? SECRET : undefined,
      })

      expect(health.apiKeyPresent).toBe(apiKeyKind !== "missing")
      expect(health.apiKeyKind).toBe(apiKeyKind)
      expect(health.fromPresent).toBe(fromDomainKind !== "missing")
      expect(health.fromDomainKind).toBe(fromDomainKind)
      expect(health.replyToPresent).toBe(replyTo)
      expect(health.orderAccessSecretPresent).toBe(orderSecret)
      expect(health.stepUpSecretPresent).toBe(stepUpSecret)

      // Ready means Brevo would accept a message: the key and the sender are the
      // only two things that decide that.
      expect(health.ready).toBe(apiKeyKind === "api" && fromDomainKind === "own")

      const expectedProblems =
        keyProblemCount(apiKeyKind) +
        fromProblemCount(fromDomainKind) +
        (replyTo ? 0 : 1) +
        (orderSecret ? 0 : 1) +
        (stepUpSecret ? 0 : 1)

      expect(health.problems).toHaveLength(expectedProblems)
    },
  )

  it("never returns a value, a prefix or an address", () => {
    const key = "xkeysib-0123456789abcdef0123456789abcdef"
    const health = getEmailConfigHealth({
      BREVO_API_KEY: key,
      EMAIL_FROM: "no-reply@affilova.com",
      EMAIL_REPLY_TO: "support@affilova.com",
      ORDER_ACCESS_SECRET: SECRET,
      STEP_UP_SECRET: SECRET,
    })

    const printed = JSON.stringify(health)

    expect(printed).not.toContain(key)
    expect(printed).not.toContain("xkeysib")
    expect(printed).not.toContain("affilova.com")
    expect(printed).not.toContain(SECRET)
    expect(printed).not.toContain("support@")
  })

  it("says the key is an SMTP key when it is one", () => {
    const health = getEmailConfigHealth({ BREVO_API_KEY: API_KEYS.smtp, EMAIL_FROM: FROM_ADDRESSES.own })

    expect(health.apiKeyKind).toBe("smtp")
    expect(health.ready).toBe(false)
    expect(health.problems.join(" ")).toContain("looks like an SMTP key")
  })

  it("says the sender is a free mailbox when it is one", () => {
    const health = getEmailConfigHealth({ BREVO_API_KEY: API_KEYS.api, EMAIL_FROM: "no-reply@gmail.com" })

    expect(health.fromDomainKind).toBe("free_mail")
    expect(health.ready).toBe(false)
    expect(health.problems.join(" ")).toContain("free mail domain")
  })

  it("treats a blank setting as absent", () => {
    const health = getEmailConfigHealth({ BREVO_API_KEY: "   ", EMAIL_FROM: "" })

    expect(health.apiKeyKind).toBe("missing")
    expect(health.fromDomainKind).toBe("missing")
  })

  it("rejects a short signing secret, because the getters would", () => {
    const health = getEmailConfigHealth({
      BREVO_API_KEY: API_KEYS.api,
      EMAIL_FROM: FROM_ADDRESSES.own,
      ORDER_ACCESS_SECRET: "too-short",
      STEP_UP_SECRET: "too-short",
    })

    expect(health.orderAccessSecretPresent).toBe(false)
    expect(health.stepUpSecretPresent).toBe(false)
    expect(health.ready).toBe(true)
  })

  it("accepts an address on a subdomain of an owned domain", () => {
    const health = getEmailConfigHealth({ BREVO_API_KEY: API_KEYS.api, EMAIL_FROM: "no-reply@mail.affilova.com" })

    expect(health.fromDomainKind).toBe("own")
    expect(health.ready).toBe(true)
  })

  it("rejects an address with a display name or two at signs", () => {
    for (const address of ["Affilova <no-reply@affilova.com>", "a@b@affilova.com", "@affilova.com", "no-reply@"]) {
      expect(getEmailConfigHealth({ EMAIL_FROM: address }).fromDomainKind, address).toBe("invalid")
    }
  })

  it("is empty of problems when everything is set", () => {
    const health = getEmailConfigHealth({
      BREVO_API_KEY: API_KEYS.api,
      EMAIL_FROM: FROM_ADDRESSES.own,
      EMAIL_REPLY_TO: "support@affilova.com",
      ORDER_ACCESS_SECRET: SECRET,
      STEP_UP_SECRET: SECRET,
    })

    expect(health.problems).toEqual([])
    expect(health.ready).toBe(true)
  })

  it("reads the deployment when it is given nothing", () => {
    const saved = { ...process.env }

    try {
      process.env.BREVO_API_KEY = API_KEYS.api
      process.env.EMAIL_FROM = FROM_ADDRESSES.own

      expect(getEmailConfigHealth().apiKeyKind).toBe("api")
    } finally {
      process.env.BREVO_API_KEY = saved.BREVO_API_KEY
      process.env.EMAIL_FROM = saved.EMAIL_FROM
    }
  })
})

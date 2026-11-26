import { describe, expect, it } from "vitest"

import {
  EMAIL_FAILURE_REASONS,
  EMAIL_REASON_ADVICE,
  FREE_MAIL_DOMAINS,
  domainOf,
  emailFailureReason,
  emailFailureTone,
  isEmailFailureReason,
  isFreeMailDomain,
  isRetryableReason,
  readProviderCode,
  readProviderMessage,
} from "./reasons"

// Every reason in the list is reachable from a status and, for the four that
// share one, from the provider's words. The table is the specification: one row
// per documented mapping, plus the two that are not a status at all.

describe("emailFailureReason", () => {
  const cases: ReadonlyArray<[string, number, string, string]> = [
    ["a 401 is an unauthorized key", 401, "key not found", "unauthorized"],
    ["a 401 naming the ip is an ip block", 401, "your ip address is not authorized", "ip_not_authorized"],
    ["a 401 naming an unrecognised ip", 401, "unrecognised ip", "ip_not_authorized"],
    ["a 403 is unauthorized", 403, "forbidden", "unauthorized"],
    ["a 403 naming the ip is an ip block", 403, "ip address is not allowed", "ip_not_authorized"],
    ["a 400 naming the sender is a bad sender", 400, "sender email is not valid", "invalid_sender"],
    ["a 400 naming a free domain is a bad sender", 400, "gmail.com is not allowed", "invalid_sender"],
    ["a 400 about anything else is a bad request", 400, "htmlContent is missing", "invalid_request"],
    ["a 402 is a quota problem", 402, "not enough credits", "quota"],
    ["a 429 is a quota problem", 429, "too many requests", "quota"],
    ["a 500 is a provider error", 500, "internal", "provider_error"],
    ["a 502 is a provider error", 502, "bad gateway", "provider_error"],
    ["a 503 is a provider error", 503, "unavailable", "provider_error"],
    ["an undocumented 4xx is a bad request", 418, "teapot", "invalid_request"],
  ]

  it.each(cases)("%s", (_name, status, message, expected) => {
    expect(emailFailureReason(status, message, "unknown")).toBe(expected)
  })

  it("uses the machine code when the message says nothing", () => {
    expect(emailFailureReason(401, "", "ip_not_authorized")).toBe("ip_not_authorized")
    expect(emailFailureReason(400, "", "invalid_sender")).toBe("invalid_sender")
  })

  it("never returns a reason outside the list", () => {
    for (const status of [400, 401, 402, 403, 404, 409, 418, 429, 500, 503, 599]) {
      expect(EMAIL_FAILURE_REASONS).toContain(emailFailureReason(status, "", "unknown"))
    }
  })
})

describe("readProviderCode", () => {
  it("keeps a short machine code", () => {
    expect(readProviderCode({ code: "invalid_parameter" })).toBe("invalid_parameter")
    expect(readProviderCode({ code: "IP_NOT_AUTHORIZED" })).toBe("ip_not_authorized")
    expect(readProviderCode({ code: "  unauthorized  " })).toBe("unauthorized")
  })

  it("answers unknown for anything that is not one", () => {
    expect(readProviderCode({ code: "not a code" })).toBe("unknown")
    expect(readProviderCode({ code: "code-with-dash" })).toBe("unknown")
    expect(readProviderCode({ code: "a".repeat(41) })).toBe("unknown")
    expect(readProviderCode({ code: 42 })).toBe("unknown")
    expect(readProviderCode({ message: "no code here" })).toBe("unknown")
    expect(readProviderCode(null)).toBe("unknown")
    expect(readProviderCode("a string")).toBe("unknown")
  })

  it("keeps exactly forty characters", () => {
    expect(readProviderCode({ code: "a".repeat(40) })).toBe("a".repeat(40))
  })
})

describe("readProviderMessage", () => {
  it("lower-cases and trims, and never invents one", () => {
    expect(readProviderMessage({ message: "  Sender Not Valid " })).toBe("sender not valid")
    expect(readProviderMessage({ message: 12 })).toBe("")
    expect(readProviderMessage({})).toBe("")
    expect(readProviderMessage(undefined)).toBe("")
  })
})

describe("the advice table", () => {
  it("has a sentence for every reason and for the two legacy words", () => {
    for (const reason of EMAIL_FAILURE_REASONS) {
      expect(EMAIL_REASON_ADVICE[reason]).toBeTruthy()
    }

    expect(EMAIL_REASON_ADVICE.rejected).toBeTruthy()
    expect(EMAIL_REASON_ADVICE.unavailable).toBeTruthy()
  })

  it("names the Authorized IPs screen for an ip block", () => {
    expect(EMAIL_REASON_ADVICE.ip_not_authorized).toContain("Authorized IPs")
  })

  it("names the API keys screen for a wrong key kind", () => {
    expect(EMAIL_REASON_ADVICE.unauthorized).toContain("API keys")
  })

  it("explains the free mail domain refusal", () => {
    expect(EMAIL_REASON_ADVICE.invalid_sender).toContain("free mail domain")
  })
})

describe("the tone of a failure", () => {
  it("asks for a retry only when waiting can help", () => {
    expect(emailFailureTone("quota")).toBe("retry")
    expect(emailFailureTone("provider_error")).toBe("retry")
    expect(emailFailureTone("network")).toBe("retry")
  })

  it("points at a human for everything a person must fix", () => {
    expect(emailFailureTone("not_configured")).toBe("support")
    expect(emailFailureTone("invalid_sender")).toBe("support")
    expect(emailFailureTone("ip_not_authorized")).toBe("support")
    expect(emailFailureTone("unauthorized")).toBe("support")
    expect(emailFailureTone("invalid_request")).toBe("support")
  })
})

describe("retryability", () => {
  it("retries a provider error and a network failure only", () => {
    for (const reason of EMAIL_FAILURE_REASONS) {
      const retryable = reason === "provider_error" || reason === "network"

      expect(isRetryableReason(reason), reason).toBe(retryable)
    }
  })
})

describe("free mail domains", () => {
  it("covers the mailboxes a sender may not use", () => {
    for (const domain of ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "proton.me"]) {
      expect(isFreeMailDomain(domain), domain).toBe(true)
    }

    expect(isFreeMailDomain("GMAIL.COM")).toBe(true)
    expect(FREE_MAIL_DOMAINS).toContain("googlemail.com")
  })

  it("does not cover an owned domain", () => {
    expect(isFreeMailDomain("affilova.com")).toBe(false)
    expect(isFreeMailDomain("mail.affilova.com")).toBe(false)
  })

  it("reads the domain out of an address", () => {
    expect(domainOf("no-reply@affilova.com")).toBe("affilova.com")
    expect(domainOf("No-Reply@Affilova.COM")).toBe("affilova.com")
    expect(domainOf("not-an-address")).toBe("")
    expect(domainOf("a@b@c.com")).toBe("c.com")
  })
})

describe("isEmailFailureReason", () => {
  it("accepts the list and rejects the legacy words", () => {
    expect(isEmailFailureReason("quota")).toBe(true)
    expect(isEmailFailureReason("rejected")).toBe(false)
    expect(isEmailFailureReason("")).toBe(false)
    expect(isEmailFailureReason(null)).toBe(false)
  })
})

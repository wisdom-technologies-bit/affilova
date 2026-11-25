import { describe, expect, it } from "vitest"

import { stepUpCodeEmail, withdrawalNoticeEmail } from "./templates"

const branding = { siteUrl: "https://affilova.example", contactUrl: "https://affilova.example/contact" }

describe("stepUpCodeEmail", () => {
  const mail = stepUpCodeEmail({ code: "004821", purpose: "withdrawal", expiresInMinutes: 10, branding })

  it("shows the code with its leading zeros, in HTML and in text", () => {
    expect(mail.html).toContain("004821")
    expect(mail.text).toContain("004821")
  })

  it("says it expires in 10 minutes and what to do if it was not requested", () => {
    expect(mail.html).toContain("expires in 10 minutes")
    expect(mail.text).toContain("expires in 10 minutes")
    expect(mail.html).toContain("If you did not request this, change your password and contact us.")
    expect(mail.text).toContain("If you did not request this, change your password and contact us.")
  })

  it("names the action", () => {
    expect(mail.text).toContain("request a withdrawal")
    expect(stepUpCodeEmail({ code: "000001", purpose: "bank_change", expiresInMinutes: 10, branding }).text).toContain(
      "change your payout account",
    )
  })

  it("has no tracking pixel and no link other than the logo and contact page", () => {
    expect(mail.html).not.toMatch(/<img[^>]+width="1"/)
    const links = [...mail.html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1])
    expect(links.every((link) => link?.startsWith("https://affilova.example"))).toBe(true)
  })

  it("is responsive", () => {
    expect(mail.html).toContain('name="viewport"')
  })
})

describe("withdrawalNoticeEmail", () => {
  const amounts = { grossKobo: BigInt(500000), feeKobo: BigInt(10000), netKobo: BigInt(490000), branding }

  it.each(["paid", "failed", "reversed", "rejected"] as const)("states amount, fee and net for %s", (status) => {
    const mail = withdrawalNoticeEmail({ status, ...amounts })

    for (const part of ["₦5,000", "₦100", "₦4,900"]) {
      expect(mail.html).toContain(part)
      expect(mail.text).toContain(part)
    }
  })

  it("has a different subject for each outcome", () => {
    const subjects = (["paid", "failed", "reversed", "rejected"] as const).map(
      (status) => withdrawalNoticeEmail({ status, ...amounts }).subject,
    )

    expect(new Set(subjects).size).toBe(4)
  })

  it("says the money is back for failed, reversed and rejected, and not for paid", () => {
    expect(withdrawalNoticeEmail({ status: "failed", ...amounts }).text).toContain("back in your available balance")
    expect(withdrawalNoticeEmail({ status: "reversed", ...amounts }).text).toContain("back in your available balance")
    expect(withdrawalNoticeEmail({ status: "rejected", ...amounts }).text).toContain("back in your available balance")
    expect(withdrawalNoticeEmail({ status: "paid", ...amounts }).text).not.toContain("back in your available balance")
  })

  it("escapes a rejection reason and ignores a reason on other statuses", () => {
    const mail = withdrawalNoticeEmail({ status: "rejected", reason: '<script>alert("x")</script>', ...amounts })

    expect(mail.html).not.toContain("<script>")
    expect(mail.html).toContain("&lt;script&gt;")
    expect(withdrawalNoticeEmail({ status: "paid", reason: "secret reason", ...amounts }).text).not.toContain(
      "secret reason",
    )
  })

  it("never mentions an account number", () => {
    const mail = withdrawalNoticeEmail({ status: "paid", ...amounts })

    expect(mail.html).not.toMatch(/[0-9]{10}/)
    expect(mail.text).not.toMatch(/[0-9]{10}/)
  })
})

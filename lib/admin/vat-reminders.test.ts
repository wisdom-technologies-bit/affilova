import { describe, expect, it, vi } from "vitest"

import { periodLabel, reminderKind, reminderRecipientHash, runVatReminders } from "./vat-reminders"
import type { VatReminderTarget } from "./screen-types"

const TARGET: VatReminderTarget = {
  period: "2026-09-01",
  reminder: "due_soon",
  dueDate: "2026-10-21",
  netPayableKobo: BigInt(31_000),
  status: "open",
}

const BRANDING = { siteUrl: "https://example.test", contactUrl: "https://account.example.test/support" }

function deps(overrides: Partial<Parameters<typeof runVatReminders>[0]> = {}) {
  const claims = new Set<string>()
  const sent: { to: string; subject: string; template: string }[] = []
  const settled: { kind: string; ok: boolean }[] = []

  const base: Parameters<typeof runVatReminders>[0] = {
    targets: async () => TARGET,
    recipients: async () => [
      { userId: "u1", email: "finance@example.test" },
      { userId: "u2", email: "admin@example.test" },
    ],
    claim: async (kind) => {
      if (claims.has(kind)) {
        return false
      }

      claims.add(kind)
      return true
    },
    settle: async (kind, _hash, result) => {
      settled.push({ kind, ok: result.ok })
    },
    send: async (input) => {
      sent.push({ to: input.to, subject: input.subject, template: input.template })

      return { ok: true, messageId: "m1" }
    },
    branding: BRANDING,
    vatUrl: "https://admin.example.test/vat",
    today: "2026-10-14",
    ...overrides,
  }

  return { deps: base, claims, sent, settled }
}

describe("runVatReminders", () => {
  it("sends one email to each finance or admin account", async () => {
    const { deps: d, sent } = deps()

    const summary = await runVatReminders(d)

    expect(summary).toEqual({ period: "2026-09-01", reminder: "due_soon", sent: 2, skipped: 0, failed: 0 })
    expect(sent.map((entry) => entry.to)).toEqual(["finance@example.test", "admin@example.test"])
    expect(sent[0]?.template).toBe("vat_reminder")
  })

  it("sends nothing twice: a second run in the same day is all skips", async () => {
    const { deps: d, sent } = deps()

    await runVatReminders(d)
    const second = await runVatReminders(d)

    expect(sent).toHaveLength(2)
    expect(second).toEqual({ period: "2026-09-01", reminder: "due_soon", sent: 0, skipped: 2, failed: 0 })
  })

  it("does nothing on a day with no reminder", async () => {
    const { deps: d, sent } = deps({ targets: async () => null })

    const summary = await runVatReminders(d)

    expect(summary).toEqual({ period: null, reminder: null, sent: 0, skipped: 0, failed: 0 })
    expect(sent).toHaveLength(0)
  })

  it("releases the claim when a send fails, so tomorrow tries again", async () => {
    const { deps: d, sent, settled } = deps({
      send: async () => ({ ok: false }),
    })

    const summary = await runVatReminders(d)

    expect(summary.failed).toBe(2)
    expect(summary.sent).toBe(0)
    expect(settled.every((entry) => entry.ok === false)).toBe(true)
    expect(sent).toHaveLength(0)
  })

  it("carries no buyer data and links to the admin VAT screen", async () => {
    const html: string[] = []
    const { deps: d } = deps({
      send: async (input) => {
        html.push(input.html, input.text)
        return { ok: true, messageId: null }
      },
    })

    await runVatReminders(d)

    expect(html.join(" ")).toContain("https://admin.example.test/vat")
    expect(html.join(" ")).toMatch(/310/)
    expect(html.join(" ").toLowerCase()).not.toContain("buyer")
  })

  it("keys the claim on the period, the reminder and a hash of the address", () => {
    const hash = reminderRecipientHash("Finance@Example.test")

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(reminderRecipientHash("finance@example.test"))
    expect(reminderKind(TARGET, hash)).toBe(`vat_reminder:2026-09-01:due_soon:${hash}`)
    expect(reminderKind(TARGET, hash)).not.toContain("finance@example.test")
  })

  it("writes the month in words", () => {
    expect(periodLabel("2026-09-01")).toBe("September 2026")
    expect(periodLabel("2026-01-01")).toBe("January 2026")
  })
})

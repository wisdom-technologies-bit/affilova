import { createHash } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  addSuppression,
  hashRecipient,
  isSuppressed,
  SUPPRESSION_LOOKUP_TIMEOUT_MS,
  type SuppressionStore,
} from "./suppression"

// The suppression list, from the application's side.
//
// What is proved here: the hash is deterministic and private; a check or a write
// that fails does not stop a message; and no address reaches a log line. The
// database half (the upsert, the roles, the audit row) is proved by
// supabase/tests/email_suppressions_test.sh.

const PEPPER = "a".repeat(40)

// The pepper is read from the environment by the production path, so the tests
// that do not pass one explicitly need it set. The tests that prove the missing
// pepper fails open delete it themselves.
beforeEach(() => {
  process.env.EMAIL_HASH_PEPPER = PEPPER
})

/** A store that answers what the test tells it to. */
function store(overrides: Partial<SuppressionStore> = {}): SuppressionStore {
  return {
    isSuppressed: async () => false,
    add: async () => 1,
    ...overrides,
  }
}

function collectLogs(): string[] {
  const lines: string[] = []

  for (const method of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "))
    })
  }

  return lines
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("hashRecipient", () => {
  it("is SHA-256 of the pepper, a colon and the lower-cased address", () => {
    const expected = createHash("sha256").update(`${PEPPER}:buyer@example.com`).digest("hex")

    expect(hashRecipient("buyer@example.com", PEPPER)).toBe(expected)
  })

  it("gives the same hash for the same address however it is written", () => {
    const hash = hashRecipient("Buyer@Example.COM", PEPPER)

    expect(hash).toBe(hashRecipient("  buyer@example.com  ", PEPPER))
    expect(hash).toBe(hashRecipient("BUYER@EXAMPLE.COM", PEPPER))
  })

  it("gives a different hash for a different address", () => {
    expect(hashRecipient("a@example.com", PEPPER)).not.toBe(hashRecipient("b@example.com", PEPPER))
  })

  it("gives a different hash for the same address under a different pepper", () => {
    expect(hashRecipient("buyer@example.com", PEPPER)).not.toBe(
      hashRecipient("buyer@example.com", "b".repeat(40)),
    )
  })

  it("is 64 lower-case hex characters, the shape the table accepts", () => {
    expect(hashRecipient("buyer@example.com", PEPPER)).toMatch(/^[0-9a-f]{64}$/)
  })

  it("refuses a pepper shorter than 32 characters", () => {
    expect(() => hashRecipient("buyer@example.com", "short")).toThrow(/at least 32/)
  })
})

describe("isSuppressed", () => {
  it("asks the store with the hash, never with the address", async () => {
    const seen: string[] = []

    await isSuppressed("buyer@example.com", {
      isSuppressed: async (hash) => {
        seen.push(hash)

        return true
      },
      add: async () => 1,
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/^[0-9a-f]{64}$/)
    expect(seen[0]).not.toContain("@")
  })

  it("fails open when the database errors, and logs without the address", async () => {
    const lines = collectLogs()

    const answer = await isSuppressed(
      "buyer@example.com",
      store({
        isSuppressed: async () => {
          throw new Error("connection refused")
        },
      }),
    )

    expect(answer).toBe(false)
    expect(lines.join("\n")).toContain("email_suppression_check_failed")
    expect(lines.join("\n")).not.toContain("buyer@example.com")
  })

  it("fails open when the pepper is missing", async () => {
    const lines = collectLogs()
    const previous = process.env.EMAIL_HASH_PEPPER
    delete process.env.EMAIL_HASH_PEPPER

    try {
      const answer = await isSuppressed("buyer@example.com", store())

      expect(answer).toBe(false)
      expect(lines.join("\n")).toContain("hash_unavailable")
    } finally {
      if (previous !== undefined) {
        process.env.EMAIL_HASH_PEPPER = previous
      }
    }
  })

  it("gives up on a lookup that hangs, and sends anyway", async () => {
    vi.useFakeTimers()
    const lines = collectLogs()

    const pending = isSuppressed(
      "buyer@example.com",
      store({ isSuppressed: () => new Promise<boolean>(() => {}) }),
    )

    await vi.advanceTimersByTimeAsync(SUPPRESSION_LOOKUP_TIMEOUT_MS + 1)

    await expect(pending).resolves.toBe(false)
    expect(lines.join("\n")).toContain("lookup_failed")
  })
})

describe("addSuppression", () => {
  it("writes the hash, the reason and the source, and reports the count", async () => {
    const seen: Array<{ hash: string; reason: string; source: string }> = []

    const result = await addSuppression("buyer@example.com", "hard_bounce", "brevo_webhook", {
      isSuppressed: async () => false,
      add: async (hash, reason, source) => {
        seen.push({ hash, reason, source })

        return 3
      },
    })

    expect(result).toEqual({ ok: true, events: 3 })
    expect(seen[0]?.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(seen[0]?.reason).toBe("hard_bounce")
    expect(seen[0]?.source).toBe("brevo_webhook")
  })

  it("cuts a long source to the column's length", async () => {
    const seen: string[] = []

    await addSuppression("buyer@example.com", "complaint", "x".repeat(200), {
      isSuppressed: async () => false,
      add: async (_hash, _reason, source) => {
        seen.push(source)

        return 1
      },
    })

    expect(seen[0]).toHaveLength(60)
  })

  it("never throws when the write fails, and logs without the address", async () => {
    const lines = collectLogs()

    const result = await addSuppression(
      "buyer@example.com",
      "blocked",
      "brevo_webhook",
      store({
        add: async () => {
          throw new Error("deadlock detected")
        },
      }),
    )

    expect(result).toEqual({ ok: false, events: null })
    expect(lines.join("\n")).toContain("email_suppression_write_failed")
    expect(lines.join("\n")).not.toContain("buyer@example.com")
  })

  it("does not write when the address cannot be hashed", async () => {
    const add = vi.fn(async () => 1)
    const previous = process.env.EMAIL_HASH_PEPPER
    delete process.env.EMAIL_HASH_PEPPER

    try {
      const result = await addSuppression("buyer@example.com", "invalid", "brevo_webhook", {
        isSuppressed: async () => false,
        add,
      })

      expect(result.ok).toBe(false)
      expect(add).not.toHaveBeenCalled()
    } finally {
      if (previous !== undefined) {
        process.env.EMAIL_HASH_PEPPER = previous
      }
    }
  })

  it("logs the reason and the count, which are not personal data", async () => {
    const lines = collectLogs()

    await addSuppression("buyer@example.com", "unsubscribed", "brevo_webhook", store())

    expect(lines.join("\n")).toContain("email_suppressed")
    expect(lines.join("\n")).toContain("unsubscribed")
  })
})

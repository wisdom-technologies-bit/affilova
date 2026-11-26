import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

// The Security page body, rendered as markup in each state it can be in.
//
// The point of these tests is what a person reads: a state is always a word, the
// self-test results always say Passed or Failed next to the icon, and a page
// whose overview failed still offers the button.

vi.mock("@/lib/ops/actions", () => ({
  runScannerSelfTestAction: vi.fn(),
  sendTestEmailAction: vi.fn(),
}))

import { SecurityPanel, SelfTestResults } from "@/components/ops/security-panel"
import type { SecurityOverview } from "@/lib/ops/actions"
import type { SelfTestRow } from "@/lib/ops/scanner-selftest"

const NOW = "2026-11-18T13:00:00.000Z"

const OVERVIEW: SecurityOverview = {
  scanner: { state: "ok", clamd: true, signatureAgeHours: 7 },
  scan: {
    counts: {
      not_scanned: 2,
      queued: 1,
      scanning: 0,
      clean: 5,
      infected: 0,
      rejected: 1,
      needs_review: 0,
      error: 0,
    },
    oldestQueuedMinutes: 12.5,
    scansLast24h: 40,
    infectedLast30d: 1,
  },
  jobs: {
    counts: { queued: 3, running: 0, done: 10, failed: 0, dead: 0 },
    oldestQueuedMinutes: 0.5,
    deadCount: 0,
    heartbeats: [
      {
        job: "process-queue",
        lastRunAt: "2026-11-18T12:59:30.000Z",
        lastStatus: "ok",
        lastDurationMs: 120,
        ageSeconds: 30,
      },
      {
        job: "scan-sweep",
        lastRunAt: "2026-11-18T12:55:00.000Z",
        lastStatus: "ok",
        lastDurationMs: 900,
        ageSeconds: 300,
      },
    ],
  },
  payments: {
    mode: "test",
    webhookEvents: { received: 0, processed: 12, ignored: 3, failed: 1 },
    windowHours: 24,
  },
  payouts: {
    counts: {
      requested: 2,
      approved: 1,
      processing: 0,
      paid: 8,
      failed: 1,
      reversed: 0,
      rejected: 0,
      cancelled: 0,
    },
    failedLast7d: 1,
    oldestRequestedMinutes: 90,
    paystackBalanceKobo: "25000000",
    lowBalance: false,
  },
  email: {
    health: {
      apiKeyPresent: true,
      apiKeyKind: "api",
      fromPresent: true,
      fromDomainKind: "own",
      replyToPresent: true,
      orderAccessSecretPresent: true,
      stepUpSecretPresent: true,
      ready: true,
      problems: [],
    },
    failuresAvailable: true,
    last24h: { total: 3, byReason: { unauthorized: 2, provider_error: 1 } },
    suppressions: {
      available: true,
      summary: {
        total: 4,
        byReason: { hard_bounce: 3, complaint: 1, blocked: 0, invalid: 0, unsubscribed: 0 },
      },
    },
    recent: [
      {
        template: "purchase_receipt",
        status: 401,
        reason: "unauthorized",
        createdAt: "2026-11-18T12:30:00.000Z",
      },
      {
        template: "step_up_code",
        status: 503,
        reason: "provider_error",
        createdAt: "2026-11-18T11:00:00.000Z",
      },
    ],
  },
  events: [
    {
      verdict: "clean",
      detail: "clean",
      engine: "bouncer",
      signatureVersion: null,
      createdAt: "2026-11-18T12:00:00.000Z",
    },
  ],
  fetchedAt: NOW,
}

function render(overrides: Partial<SecurityOverview> = {}, overviewError: string | null = null): string {
  return renderToStaticMarkup(
    createElement(SecurityPanel, {
      overview: { ...OVERVIEW, ...overrides },
      overviewError,
      nowIso: NOW,
    }),
  )
}

const ROWS: readonly SelfTestRow[] = [
  { name: "hello.txt", expected: "clean (clean)", actual: "clean (clean)", passed: true, durationMs: 40 },
  {
    name: "eicar.txt",
    expected: "infected (Eicar…)",
    actual: "infected (Eicar-Test-Signature)",
    passed: true,
    durationMs: 20,
  },
  {
    name: "not-a-pdf.pdf",
    expected: "rejected (executable_type)",
    actual: "rejected (executable_type)",
    passed: true,
    durationMs: 9,
  },
  {
    name: "archive.zip",
    expected: "needs_review (archive_contains_executable)",
    actual: "needs_review (archive_contains_executable)",
    passed: true,
    durationMs: 18,
  },
]

function renderResults(
  rows: readonly SelfTestRow[] | null,
  summary = "",
  error: string | null = null,
): string {
  return renderToStaticMarkup(createElement(SelfTestResults, { rows, summary, error }))
}

describe("the Security page, scanner section", () => {
  it("says the scanner is ready when it is", () => {
    const html = render()

    expect(html).toContain("Ready")
  })

  it("names Bouncer as the engine and says the signature age does not apply", () => {
    const html = render()

    expect(html).toContain("Engine")
    expect(html).toContain("Bouncer")
    expect(html).toContain("Signature age")
    expect(html).toContain("not applicable")
  })

  it("keeps saying so whatever the scanner reported about signatures", () => {
    // /healthz no longer reports clamd or a signature age, and an older service
    // that still does must not make the page claim something it cannot check.
    for (const signatureAgeHours of [null, 7, 100]) {
      const html = render({ scanner: { state: "ok", clamd: true, signatureAgeHours } })

      expect(html).toContain("Bouncer")
      expect(html).toContain("not applicable")
    }
  })

  it("says reachable but not ready when the service answers and is not ready", () => {
    const html = render({ scanner: { state: "degraded", clamd: false, signatureAgeHours: 7 } })

    expect(html).toContain("Reachable, but not ready to scan")
  })

  it("says unreachable when the service did not answer", () => {
    const html = render({ scanner: { state: "unreachable", clamd: false, signatureAgeHours: null } })

    expect(html).toContain("Unreachable: the service did not answer")
    expect(html).not.toContain("Unknown: the scanner did not report an age")
  })
})

describe("the Security page, scan pipeline", () => {
  it("shows a count for every status, in the words the rest of the app uses", () => {
    const html = render()

    expect(html).toContain("Not scanned yet")
    expect(html).toContain("Waiting for security scan")
    expect(html).toContain("Clean")
    expect(html).toContain("Rejected: this file type or content is not allowed")
  })

  it("shows how long the oldest file has waited, and the last day's volume", () => {
    const html = render()

    expect(html).toContain("12.5 minutes")
    expect(html).toContain("40 scan answers")
    expect(html).toContain("Infections, 30 days")
  })

  it("says nothing is waiting rather than showing a zero", () => {
    const html = render({
      scan: { ...OVERVIEW.scan, oldestQueuedMinutes: null },
    })

    expect(html).toContain("Nothing is waiting")
  })
})

describe("the Security page, background jobs", () => {
  it("shows the queue counts and says no job has given up", () => {
    const html = render()

    expect(html).toContain("Dead jobs")
    expect(html).toContain("None")
    expect(html).toContain("0.5 minutes")
  })

  it("shows how many jobs gave up when some did", () => {
    const html = render({
      jobs: { ...OVERVIEW.jobs, deadCount: 2, counts: { ...OVERVIEW.jobs.counts, dead: 2 } },
    })

    expect(html).toContain("2 gave up")
  })

  it("calls a heartbeat within its interval on time", () => {
    const html = render()

    // process-queue is 30 seconds old, scan-sweep is 300 seconds old: both inside
    // their three and ten minute intervals.
    expect(html).toContain("On time")
    expect(html).not.toContain("Late")
  })

  it("calls the queue late after three minutes", () => {
    const html = render({
      jobs: {
        ...OVERVIEW.jobs,
        heartbeats: [{ ...OVERVIEW.jobs.heartbeats[0], ageSeconds: 400 }],
      },
    })

    expect(html).toContain("Late: expected within three minutes")
  })

  it("calls the sweep late after ten minutes, not after three", () => {
    const html = render({
      jobs: {
        ...OVERVIEW.jobs,
        heartbeats: [{ ...OVERVIEW.jobs.heartbeats[1], ageSeconds: 900 }],
      },
    })

    expect(html).toContain("Late: expected within ten minutes")
  })

  it("says so when no schedule has ever run", () => {
    const html = render({ jobs: { ...OVERVIEW.jobs, heartbeats: [] } })

    expect(html).toContain("No schedule has recorded a run yet")
  })
})

describe("the Security page, recent scan results", () => {
  it("lists the verdict, the detail code and the engine", () => {
    const html = render()

    expect(html).toContain("Recent scan results")
    expect(html).toContain("bouncer")
    expect(html).toContain("clean")
  })

  it("says so when nothing has answered yet", () => {
    const html = render({ events: [] })

    expect(html).toContain("No scan has answered yet.")
  })
})

describe("the Security page, when the overview cannot be read", () => {
  it("shows the error and still offers the self-test", () => {
    const html = renderToStaticMarkup(
      createElement(SecurityPanel, {
        overview: null,
        overviewError: "Something went wrong. Please try again.",
        nowIso: NOW,
      }),
    )

    expect(html).toContain("Something went wrong. Please try again.")
    expect(html).not.toContain("Scan pipeline")
    expect(html).toContain("Run scanner self-test")
  })
})

describe("the Security page, the self-test control", () => {
  it("offers one button, with an explanation of what it proves", () => {
    const html = render()

    expect(html).toContain("Run scanner self-test")
    expect(html).toContain("creates no product and no file record")
    expect(html).toContain("Five runs an hour")
  })

  it("has a live region for the results, and shows none before a run", () => {
    const html = render()

    expect(html).toContain('aria-live="polite"')
    expect(html).not.toContain("Passed")
  })
})

describe("SelfTestResults", () => {
  it("says all four passed, and writes Passed on every row", () => {
    const html = renderResults(ROWS, "All 4 checks passed.")

    expect(html).toContain("All 4 checks passed.")
    // Every row is rendered twice: once in the table for a wide screen and once
    // as a card for a phone. The two are shown by CSS, never both at once.
    expect(html.match(/>Passed</g) ?? []).toHaveLength(8)
    expect(html).toContain("eicar.txt")
    expect(html).toContain("infected (Eicar-Test-Signature)")
  })

  it("names the count when one fails, and writes Failed on that row", () => {
    const rows = ROWS.map((row, index) =>
      index === 1
        ? { ...row, actual: "clean (clean)", passed: false }
        : row,
    )

    const html = renderResults(rows, "3 passed, 1 failed.")

    expect(html).toContain("3 passed, 1 failed.")
    expect(html.match(/>Passed</g) ?? []).toHaveLength(6)
    expect(html.match(/>Failed</g) ?? []).toHaveLength(2)
  })

  it("never relies on colour alone: every result carries an icon and a word", () => {
    const html = renderResults(ROWS, "All 4 checks passed.")

    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain("Passed")
  })

  it("shows the error in an alert when the run could not start", () => {
    const html = renderResults(null, "", "Too many attempts. Please wait a few minutes and try again.")

    expect(html).toContain('role="alert"')
    expect(html).toContain("Too many attempts")
  })
})

describe("the Security page, payments section", () => {
  it("says which Paystack mode the deployment is in", () => {
    expect(render()).toContain("Test mode: no real money moves")

    expect(
      render({ payments: { mode: "live", webhookEvents: { received: 0, processed: 0, ignored: 0, failed: 0 }, windowHours: 24 } }),
    ).toContain("Live mode: real money moves")
  })

  it("says so plainly when there is no key or the key is wrong", () => {
    expect(
      render({ payments: { mode: "unconfigured", webhookEvents: { received: 0, processed: 0, ignored: 0, failed: 0 }, windowHours: 24 } }),
    ).toContain("Not configured: no Paystack secret key is set")

    expect(
      render({ payments: { mode: "invalid", webhookEvents: { received: 0, processed: 0, ignored: 0, failed: 0 }, windowHours: 24 } }),
    ).toContain("The Paystack secret key is not a test or live key")
  })

  it("shows the webhook counts of the last day, one per status", () => {
    const html = render()

    expect(html).toContain("Webhook events, last 24 hours")
    expect(html).toContain("processed")
    expect(html).toContain("ignored")
    expect(html).toContain("failed")
    expect(html).toContain("12")
    expect(html).toContain("3")
  })
})

describe("the Security page, email section", () => {
  it("says the deployment is ready when the key and the sender are right", () => {
    const html = render()

    expect(html).toContain("Email")
    expect(html).toContain("Ready to send")
    expect(html).toContain("An API key is set")
    expect(html).toContain("An address on your own domain")
  })

  it("names the wrong key kind without showing the key", () => {
    const html = render({
      email: { ...OVERVIEW.email, health: { ...OVERVIEW.email.health, apiKeyKind: "smtp", ready: false } },
    })

    expect(html).toContain("An SMTP key is set, not an API key")
    expect(html).toContain("Not ready to send")
    expect(html).not.toContain("xkeysib")
    expect(html).not.toContain("xsmtpsib")
  })

  it("names a free mail sender as the reason Brevo refuses", () => {
    const html = render({
      email: {
        ...OVERVIEW.email,
        health: {
          ...OVERVIEW.email.health,
          fromDomainKind: "free_mail",
          ready: false,
          problems: ["EMAIL_FROM uses a free mail domain, which Brevo does not accept as a sender; use an address on your own authenticated domain."],
        },
      },
    })

    expect(html).toContain("A free mail domain, which Brevo does not accept")
    expect(html).toContain("EMAIL_FROM uses a free mail domain")
  })

  it("warns about the optional settings without calling the deployment broken", () => {
    const html = render({
      email: {
        ...OVERVIEW.email,
        health: {
          ...OVERVIEW.email.health,
          replyToPresent: false,
          orderAccessSecretPresent: false,
          stepUpSecretPresent: false,
        },
      },
    })

    expect(html).toContain("Not set: a reply reaches nobody")
    expect(html).toContain("download links cannot be signed")
    expect(html).toContain("step-up codes cannot be issued")
    // The two that decide whether a message can be sent are still right.
    expect(html).toContain("Ready to send")
  })

  it("counts the failures of the last day by reason", () => {
    const html = render()

    expect(html).toContain("3 failed sends")
    expect(html).toContain("Unauthorized")
    expect(html).toContain("Provider error")
    expect(html).toContain("purchase_receipt")
    expect(html).toContain("step_up_code")
  })

  it("says nothing has failed rather than showing an empty table", () => {
    const html = render({
      email: { ...OVERVIEW.email, last24h: { total: 0, byReason: {} }, recent: [] },
    })

    expect(html).toContain("No send has failed in the last 24 hours.")
    expect(html).toContain("Nothing has failed yet.")
  })

  it("says the failure table is not readable rather than claiming zero", () => {
    const html = render({
      email: { ...OVERVIEW.email, failuresAvailable: false, last24h: { total: 0, byReason: {} }, recent: [] },
    })

    expect(html).toContain("The failure table is not readable for your role.")
  })

  it("never shows an address on the card", () => {
    const html = render()

    expect(html).not.toContain("@")
  })

  it("offers the test button and says where the message goes", () => {
    const html = render()

    expect(html).toContain("Send test email")
    expect(html).toContain("to your own address")
  })
})

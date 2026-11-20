"use client"

import { AlertTriangle, Check, Loader2, X } from "lucide-react"
import { useState } from "react"

import { formatLagosDateTime, scanStatusLabel, timeAgo } from "@/lib/catalog/format"
import { runScannerSelfTestAction } from "@/lib/ops/actions"
import type { JobHeartbeat, ScanEventRow, SecurityOverview } from "@/lib/ops/actions"
import type { ScannerHealth, SelfTestRow } from "@/lib/ops/scanner-selftest"

// The admin Security page.
//
// Everything above the button is read-only and arrives from the server action.
// The button is the one-click proof: four known files go through the real scan
// pipeline and the four verdicts are shown next to what each one must be.
//
// Two rules for the whole page:
//   * a state is never shown by colour alone. Every badge carries a word, and the
//     icon is decorative (aria-hidden), so the page reads correctly in a
//     screen reader and in greyscale.
//   * the self-test results arrive in a live region, so a screen reader hears the
//     outcome without the focus moving.

/** How long each cron job may go without a heartbeat before it counts as late. */
const HEARTBEAT_LIMIT_SECONDS: Readonly<Record<string, number>> = {
  "process-queue": 3 * 60,
  "scan-sweep": 10 * 60,
}

const HEARTBEAT_LIMIT_WORDS: Readonly<Record<string, string>> = {
  "process-queue": "three minutes",
  "scan-sweep": "ten minutes",
}

function scannerStateWords(health: ScannerHealth): string {
  if (health.state === "unreachable") {
    return "Unreachable: the service did not answer"
  }

  if (health.state === "degraded") {
    return "Reachable, but not ready to scan"
  }

  return "Ready"
}

function formatAge(seconds: number): string {
  if (seconds < 90) {
    return `${seconds} seconds ago`
  }

  if (seconds < 5400) {
    const minutes = Math.round(seconds / 60)

    return `${minutes} minutes ago`
  }

  const hours = Math.round(seconds / 3600)

  return hours === 1 ? "1 hour ago" : `${hours} hours ago`
}

function heartbeatStateWords(beat: JobHeartbeat): { label: string; late: boolean } {
  const limit = HEARTBEAT_LIMIT_SECONDS[beat.job]

  if (limit === undefined) {
    return { label: "No expected interval recorded for this job", late: false }
  }

  if (beat.ageSeconds <= limit) {
    return { label: "On time", late: false }
  }

  return {
    label: `Late: expected within ${HEARTBEAT_LIMIT_WORDS[beat.job] ?? `${limit} seconds`}`,
    late: true,
  }
}

function statusWord(value: string): string {
  const known = [
    "not_scanned",
    "queued",
    "scanning",
    "clean",
    "infected",
    "rejected",
    "needs_review",
    "error",
  ]

  return known.includes(value) ? scanStatusLabel(value as Parameters<typeof scanStatusLabel>[0]) : value
}

function Badge({ tone, children }: { tone: "good" | "bad" | "neutral"; children: string }) {
  const classes =
    tone === "good"
      ? "border-brand-600/40 bg-brand-50 text-brand-ink"
      : tone === "bad"
        ? "border-destructive/40 bg-destructive/5 text-destructive"
        : "border-border bg-muted text-muted-foreground"

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {children}
    </span>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border p-4 md:p-6">
      <h2 className="text-base font-semibold text-brand-ink">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function ScannerSection({ health }: { health: ScannerHealth }) {
  return (
    <Section
      title="Scanner"
      description="The service that downloads, types and scans every uploaded file."
    >
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Service</dt>
          <dd className="mt-1">
            <Badge tone={health.state === "ok" ? "good" : "bad"}>{scannerStateWords(health)}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Engine</dt>
          <dd className="mt-1">
            <Badge tone="neutral">Bouncer</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Signature age</dt>
          <dd className="mt-1">
            {/* Bouncer keeps its own detection data on its side, so /healthz has
                no signature age to report and there is nothing here to check. */}
            <Badge tone="neutral">not applicable</Badge>
          </dd>
        </div>
      </dl>
    </Section>
  )
}

function PipelineSection({
  scan,
  now,
}: {
  scan: SecurityOverview["scan"]
  now: Date
}) {
  const entries = Object.entries(scan.counts)

  return (
    <Section
      title="Scan pipeline"
      description="Where every uploaded file stands right now, and how much scanning has happened."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:col-span-2">
          {entries.map(([status, count]) => (
            <div key={status} className="rounded-md border border-border p-3">
              <dt className="text-xs text-muted-foreground">{statusWord(status)}</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-brand-ink">{count}</dd>
            </div>
          ))}
        </dl>

        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Oldest waiting file</dt>
            <dd className="mt-1 text-brand-ink">
              {scan.oldestQueuedMinutes === null
                ? "Nothing is waiting"
                : `${scan.oldestQueuedMinutes} minutes`}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Last 24 hours</dt>
            <dd className="mt-1 text-brand-ink">{scan.scansLast24h} scan answers</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Infections, 30 days</dt>
            <dd className="mt-1 text-brand-ink">{scan.infectedLast30d}</dd>
          </div>
          <p className="text-xs text-muted-foreground">Read at {formatLagosDateTime(now.toISOString())}.</p>
        </dl>
      </div>
    </Section>
  )
}

function JobsSection({ jobs }: { jobs: SecurityOverview["jobs"] }) {
  const entries = Object.entries(jobs.counts)

  return (
    <Section
      title="Background jobs"
      description="The queue that drives scanning and cleanup, and when each schedule last ran."
    >
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        {entries.map(([status, count]) => (
          <div key={status} className="rounded-md border border-border p-3">
            <dt className="text-xs capitalize text-muted-foreground">{status}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-brand-ink">{count}</dd>
          </div>
        ))}
      </dl>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Oldest queued job</dt>
          <dd className="mt-1 text-brand-ink">
            {jobs.oldestQueuedMinutes === null ? "Nothing is queued" : `${jobs.oldestQueuedMinutes} minutes`}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Dead jobs</dt>
          <dd className="mt-1">
            <Badge tone={jobs.deadCount === 0 ? "good" : "bad"}>
              {jobs.deadCount === 0 ? "None" : `${jobs.deadCount} gave up`}
            </Badge>
          </dd>
        </div>
      </dl>

      {jobs.heartbeats.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No schedule has recorded a run yet. If the cron has just been set up, this fills in on the
          next tick.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {jobs.heartbeats.map((beat) => {
            const state = heartbeatStateWords(beat)

            return (
              <li
                key={beat.job}
                className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-brand-ink">{beat.job}</p>
                  <p className="text-xs text-muted-foreground">
                    Last run {formatAge(beat.ageSeconds)}
                    {beat.lastDurationMs === null ? "" : `, took ${beat.lastDurationMs} ms`}
                    {beat.lastStatus === null ? "" : `, finished ${beat.lastStatus}`}
                  </p>
                </div>
                <Badge tone={state.late ? "bad" : "good"}>{state.label}</Badge>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

function EventsSection({ events, now }: { events: readonly ScanEventRow[]; now: Date }) {
  return (
    <Section
      title="Recent scan results"
      description="The last answers from the scanner. No file names and no vendors: this counts verdicts."
    >
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No scan has answered yet.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">The most recent scan results, newest first</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Verdict
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Detail
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Engine
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Signatures
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    When
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={`${event.createdAt}-${event.verdict}-${event.detail ?? ""}`} className="border-b border-border">
                    <td className="py-2 pr-4 text-brand-ink">{statusWord(event.verdict)}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-brand-ink">{event.detail ?? "—"}</td>
                    <td className="py-2 pr-4 text-brand-ink">{event.engine ?? "—"}</td>
                    <td className="py-2 pr-4 tabular-nums text-brand-ink">{event.signatureVersion ?? "—"}</td>
                    <td className="py-2 text-brand-ink">
                      <span className="block">{formatLagosDateTime(event.createdAt)}</span>
                      <span className="block text-xs text-muted-foreground">{timeAgo(event.createdAt, now)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {events.map((event) => (
              <li key={`${event.createdAt}-${event.verdict}-${event.detail ?? ""}`} className="rounded-md border border-border p-3">
                <p className="text-sm font-medium text-brand-ink">{statusWord(event.verdict)}</p>
                <p className="font-mono text-xs text-brand-ink">{event.detail ?? "—"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {event.engine ?? "—"} · signatures {event.signatureVersion ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">{formatLagosDateTime(event.createdAt)}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  )
}

function ResultCell({ passed }: { passed: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-medium ${passed ? "text-brand-ink" : "text-destructive"}`}
    >
      {passed ? (
        <Check aria-hidden="true" className="h-4 w-4" />
      ) : (
        <X aria-hidden="true" className="h-4 w-4" />
      )}
      {passed ? "Passed" : "Failed"}
    </span>
  )
}

/** The outcome of a run: the sentence, the error, or the four rows. */
export function SelfTestResults({
  rows,
  summary,
  error,
}: {
  rows: readonly SelfTestRow[] | null
  summary: string
  error: string | null
}) {
  return (
    <div aria-live="polite" className="mt-4">
      {error === null ? null : (
        <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {summary === "" ? null : <p className="mb-3 text-sm font-medium text-brand-ink">{summary}</p>}

      {rows === null || rows.length === 0 ? null : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Self-test results, one row per sample file</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Sample
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Expected
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Actual
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Time
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name} className="border-b border-border align-top">
                    <th scope="row" className="py-2 pr-4 text-left font-mono text-xs font-medium text-brand-ink">
                      {row.name}
                    </th>
                    <td className="py-2 pr-4 text-brand-ink">{row.expected}</td>
                    <td className="py-2 pr-4 text-brand-ink">{row.actual}</td>
                    <td className="py-2 pr-4 tabular-nums text-brand-ink">{row.durationMs} ms</td>
                    <td className="py-2">
                      <ResultCell passed={row.passed} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {rows.map((row) => (
              <li key={row.name} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-mono text-xs font-medium text-brand-ink">{row.name}</p>
                  <ResultCell passed={row.passed} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Expected {row.expected}</p>
                <p className="text-xs text-muted-foreground">Actual {row.actual}</p>
                <p className="text-xs text-muted-foreground">{row.durationMs} ms</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function paymentsModeWords(mode: SecurityOverview["payments"]["mode"]): {
  label: string
  good: boolean
} {
  if (mode === "test") {
    return { label: "Test mode: no real money moves", good: true }
  }

  if (mode === "live") {
    return { label: "Live mode: real money moves", good: true }
  }

  if (mode === "invalid") {
    return { label: "The Paystack secret key is not a test or live key", good: false }
  }

  return { label: "Not configured: no Paystack secret key is set", good: false }
}

function PaymentsSection({ payments }: { payments: SecurityOverview["payments"] }) {
  const mode = paymentsModeWords(payments.mode)
  const entries = Object.entries(payments.webhookEvents)

  return (
    <Section
      title="Payments"
      description="Which Paystack mode this deployment talks to, and how the webhook deliveries of the last day ended."
    >
      <dl className="grid gap-4 text-sm lg:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Paystack</dt>
          <dd className="mt-1">
            <Badge tone={mode.good ? "good" : "bad"}>{mode.label}</Badge>
          </dd>
        </div>

        <div className="lg:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Webhook events, last {payments.windowHours} hours
          </dt>
          <dd className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {entries.map(([status, count]) => (
              <div key={status} className="rounded-md border border-border p-3">
                <p className="text-xs capitalize text-muted-foreground">{status}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-brand-ink">{count}</p>
              </div>
            ))}
          </dd>
        </div>
      </dl>

      {payments.webhookEvents.failed === undefined ? null : (
        <p className="mt-3 text-xs text-muted-foreground">
          A failed delivery is one Paystack will send again: the database or Paystack itself was
          unreachable when it arrived.
        </p>
      )}
    </Section>
  )
}

function SelfTestSection() {
  const [rows, setRows] = useState<readonly SelfTestRow[] | null>(null)
  const [summary, setSummary] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  async function run(): Promise<void> {
    if (running) {
      return
    }

    setRunning(true)
    setError(null)
    setSummary("")

    const result = await runScannerSelfTestAction()

    if (result.ok) {
      setRows(result.rows)
      setSummary(
        result.failedCount === 0
          ? `All ${result.passedCount} checks passed.`
          : `${result.passedCount} passed, ${result.failedCount} failed.`,
      )
    } else {
      setRows(null)
      setError(result.error)
    }

    setRunning(false)
  }

  return (
    <Section
      title="Run scanner self-test"
      description="Sends four known files through the same pipeline a real upload uses: the bucket, the scanner, Bouncer and the policies. It creates no product and no file record."
    >
      <button
        type="button"
        onClick={() => {
          void run()
        }}
        disabled={running}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-[#10813F] px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-[#0d6b34] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {running ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
        {running ? "Running the self-test…" : "Run scanner self-test"}
      </button>

      <p className="mt-2 text-xs text-muted-foreground">
        Takes a few seconds. Five runs an hour, and each run is recorded in the audit log.
      </p>

      <SelfTestResults rows={rows} summary={summary} error={error} />
    </Section>
  )
}

export function SecurityPanel({
  overview,
  overviewError,
  nowIso,
}: {
  overview: SecurityOverview | null
  overviewError: string | null
  /** The server's clock, so an age is the same on both sides. */
  nowIso: string
}) {
  const now = new Date(nowIso)

  return (
    <div className="space-y-4">
      {overviewError === null ? null : (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{overviewError}</p>
        </div>
      )}

      {overview === null ? null : (
        <>
          <ScannerSection health={overview.scanner} />
          <PipelineSection scan={overview.scan} now={now} />
          <JobsSection jobs={overview.jobs} />
          <PaymentsSection payments={overview.payments} />
          <EventsSection events={overview.events} now={now} />
        </>
      )}

      <SelfTestSection />
    </div>
  )
}

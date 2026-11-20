# Scheduled jobs (cron)

Background work runs from an external scheduler calling one secured endpoint.
Nothing inside the app has to stay awake: **cron-job.org** sends a request on a
schedule and the endpoint does a small batch of work.

## The endpoint

```
POST https://<app host>/api/cron/<job name>
```

Only `POST` works. A browser request with no secret is refused, so no login
cookie is needed and none is accepted.

## The required header

Every request must carry this header, with the secret exactly as it is set in the
`CRON_SECRET` environment variable:

```
Authorization: Bearer <CRON_SECRET>
```

Anything else is answered with `401 {"error":"unauthorized"}` and no other
detail. `CRON_SECRET` must be at least 32 characters; see `.env.example`.

## Which jobs exist

| Job name          | Schedule      | What it does                                                          |
| ----------------- | ------------- | --------------------------------------------------------------------- |
| `process-queue`   | every minute  | Claims a small batch of queued jobs, runs them, records a heartbeat.   |
| `heartbeat-check` | every 5 min   | Reports any schedule that has not checked in for over 5 minutes.       |
| `cleanup`         | daily at 03:00 | Deletes old rate-limit windows, purges clicks older than 13 months, queues the storage sweep, records a heartbeat. |
| `scan-sweep`      | every 5 min   | Queues one scan sweep for the current minute, so new, failed and stale files are scanned. |
| `reconcile-pending` | every 10 min | Asks Paystack about pending orders and posts the ones that were paid. |
| `expire-orders`   | hourly        | Expires unpaid orders whose 24-hour window has passed.                  |
| `rollups`         | hourly        | Recomputes affiliate daily stats for yesterday and today, Lagos time.   |
| `risk-scan`       | hourly        | Flags click bursts and affiliates whose clicks never become sales.      |

Any other name is answered with `404 {"error":"not_found"}`.

`cleanup` calls `public.cleanup_rate_limits()` and forgets every window that can
no longer be counted against (the longest window the app uses is one hour, and
the function keeps a full day of history). Its answer adds the number of deleted
rows to the usual body:

```json
{"ok":true,"deleted":12,"storageCleanupQueued":true,"webhookEventsPurged":4,"clicksPurged":0}
```

`deleted` is `0` on a quiet day, which is normal. `clicksPurged` is the number
of affiliate clicks older than 13 months that were deleted; see
`docs/tracking.md` for why that is the window.

`webhookEventsPurged` is the number of webhook deliveries older than 30 days that
were forgotten. The log is only needed for as long as a Paystack retry can
arrive (72 hours in live mode), so 30 days is generous; deleting the rows is what
keeps the duplicate check cheap. `public.purge_old_webhook_events(30)` clamps the
window to 1..365 days.

`cleanup` also queues the daily `storage_cleanup` job, with the UTC date in its
de-duplication key (`storage_cleanup:2026-11-17`), so however many times the
endpoint is called that day, exactly one sweep runs. `storageCleanupQueued` is
`false` when that enqueue failed; the rate-limit cleanup still counts as done, so
the run is not reported as an error. The next day's call fixes it.

### The `storage_cleanup` job

Queued by `cleanup`, run by `process-queue` like any other job. It lists the file
reservations older than 24 hours that never became uploads, in batches of 50, and
for each one aborts the multipart upload (when there was one), deletes the object
from the private bucket and then deletes the row. The row only goes once the
object is gone: a storage outage leaves it in place for the next sweep rather
than orphaning an object nobody can find. Aborting an upload that already
completed or expired is expected and not treated as a failure.

Without this sweep, an abandoned upload would keep counting against the product's
ten-file and 5 GiB budgets, and a large abandoned upload would leave charged parts
in the bucket. See `docs/catalog.md` for the file rules. `cleanup` is **not** watched by
`heartbeat-check`: a daily job would always look overdue under the five minute
rule. Its heartbeat row is still written on every run, so a run that stopped
happening is visible in `public.cron_heartbeats`.

`storage_cleanup` is not a scheduled endpoint name: it is a job type inside the
queue (`storage_cleanup`), and `POST /api/cron/storage_cleanup` answers 404 like
any other unknown job name.

### The `reconcile-pending` job

Paystack only sends webhooks for successful charges, so an order paid while the
webhook was lost stays `pending` until someone asks. This job asks:

1. `public.list_orders_needing_verification(50)` returns the pending orders
   created more than 10 minutes and less than 24 hours ago, oldest first.
2. Each one is verified with `GET /transaction/verify/:reference`, one at a time.
3. When the verified status is `success`, `process_paid_order` is called with the
   verified amounts, fees, channel, transaction id and `paid_at`.
4. Anything else (`abandoned`, `failed`, `ongoing`, `pending`) is left alone: the
   expiry job owns those.

It stops starting new checks after 18 seconds, so the endpoint always answers
inside its 30-second limit. Its answer:

```json
{"ok":true,"checked":12,"paid":1,"skipped":11,"failed":0,"stoppedEarly":false}
```

`paid` counts orders that became paid (including one that was already paid),
`skipped` counts orders Paystack says were not paid, and `failed` counts
verifications or posts that errored. `stoppedEarly` is `true` when the time
budget ran out with orders left in the batch; the next tick picks them up.

### The `expire-orders` job

Calls `public.expire_pending_orders(500)`, which moves up to 500 pending orders
whose `expires_at` has passed to `expired`, and answers
`{"ok":true,"expired":7}`. The batch is bounded so one call never holds a long
lock. An expired order can still be paid: `process_paid_order` accepts an
`expired` order and moves it to `paid`, which is what happens when a buyer pays
just before the window closes and the webhook arrives late.

### The `rollups` job

Calls `public.rollup_affiliate_stats(yesterday, today)`, where both days are
Lagos days, and answers `{"ok":true,"days":2,"rows":3}`.

Two days, not one, because a click at 23:59 and its sale at 00:05 belong to
different days and the rollup for each is cheap. The function recomputes rather
than adds, so running it again is always safe and never double counts. Each call
is one statement over two days of data and stays far inside the 20 second
budget.

### The `risk-scan` job

Calls `public.scan_click_anomalies()` and answers
`{"ok":true,"flags":2}`.

It writes at most one flag per affiliate, kind and Lagos day:

- `click_burst`: one link took more than 200 clicks from a single IP hash within
  one hour.
- `clicks_without_sales`: an affiliate collected more than 500 unique clicks in
  24 hours and has no paid order in the same window.

A flag is a note for a person, not an automatic ban. `risk_flags` is readable by
admin and moderator only, and the scan only looks at the last 24 hours, so it
stays cheap.

### Not implemented yet

`approve-commissions` hourly, `reconcile-daily` at 02:00, `vat-reminders` on the
14th and 19th at 09:00, `payout-run` weekly. Do not add these to the scheduler
until the job exists: the endpoint answers 404 for an unknown name.

## cron-job.org settings

Create one cron job per row in the table above, with these settings:

- **URL**: `https://<app host>/api/cron/process-queue` (or the job name)
- **Method**: `POST`
- **Headers**: `Authorization` = `Bearer <CRON_SECRET>`
- **Schedule**: as in the table above (every minute, every 5 or 10 minutes, hourly, daily)
- **Timezone**: `Africa/Lagos`
- **Timeout**: 30 seconds
- **Failure notifications**: **on** (email when a run fails)

The endpoint answers in under 20 seconds by design, so a 30 second timeout is
comfortably above the normal run.

## What a run returns

| Situation                         | Status | Body                                                    |
| --------------------------------- | ------ | ------------------------------------------------------- |
| Queue processed                   | 200    | `{"ok":true,"claimed":n,"completed":n,"failed":n,"released":n}` |
| Heartbeat report                  | 200    | `{"ok":true,"stale":["process-queue"]}`                  |
| Cleanup finished                  | 200    | `{"ok":true,"deleted":n,"storageCleanupQueued":true,"webhookEventsPurged":n}` |
| Reconciliation finished           | 200    | `{"ok":true,"checked":n,"paid":n,"skipped":n,"failed":n,"stoppedEarly":false}` |
| Expiry finished                   | 200    | `{"ok":true,"expired":n}`                               |
| Missing or wrong secret           | 401    | `{"error":"unauthorized"}`                              |
| Unknown job name                  | 404    | `{"error":"not_found"}`                                 |
| Unexpected failure                | 500    | `{"ok":false}`                                          |

A single job failing is **not** a failed run: the job is marked failed (or
rescheduled) in the database and the request still answers 200 with the counts.
Only an unexpected exception returns 500. No response ever contains a secret or
error text.

## The scan sweep

`scan-sweep` is the safety net under the malware scanner. Uploads queue their own
scan as soon as they are confirmed; this endpoint catches everything else.

It does not do the work itself. Each call queues exactly one `scan_sweep` job
under a dedupe key of the current UTC minute (`scan_sweep:2026-11-18T09:33`), so
a scheduler that fires twice in the same minute still queues one sweep, and the
answer is `{"ok":true,"scanSweepQueued":true}`. A queue that refuses the job is
reported as `{"ok":true,"scanSweepQueued":false}` rather than failing the run.

The queued job then asks the database for up to 50 files that are due:
never-scanned uploads, files whose scan failed, files stuck in `queued` or
`scanning` past `scan_stale_minutes`, and clean files older than
`scan_rescan_days` on a live, paused or submitted product. One `scan_file` job is
queued per file, keyed by file and attempt count so a file is not scanned twice
for the same attempt.

Call it every five minutes. A file is therefore scanned within a few minutes of
its upload even if the immediate job was lost, and the weekly rescan runs on the
same path. If the scanner is down the files stay `queued`: nothing is lost, and
the next sweep retries them. The policy is in `docs/scanning.md`.

## How a run stays inside its time limit

- Each run claims at most 10 jobs (the database caps any batch at 50).
- Every job gets at most 8 seconds; the whole run is budgeted at 18 seconds.
- When the remaining budget is smaller than one job's timeout, the rest of the
  batch is **released** rather than failed, so the next minute picks it up with
  its attempt count intact.
- A job left `running` for more than 5 minutes (a worker that died mid-run) is
  put back in the queue automatically at the start of the next claim.

## Heartbeats

Each run writes a row into `public.cron_heartbeats`: last run time, status and
duration, on success and on failure. `heartbeat-check` reads that table and lists
every schedule that has not reported in more than 5 minutes, including one that
has never reported. Alert emails are added in a later task.

Staff can read both `public.jobs` and `public.cron_heartbeats` from the admin
dashboards; no client can write to either table.

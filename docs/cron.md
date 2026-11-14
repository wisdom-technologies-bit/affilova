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
| `cleanup`         | daily at 03:00 | Deletes rate-limit windows older than a day, records a heartbeat.     |

Any other name is answered with `404 {"error":"not_found"}`.

`cleanup` calls `public.cleanup_rate_limits()` and forgets every window that can
no longer be counted against (the longest window the app uses is one hour, and
the function keeps a full day of history). Its answer adds the number of deleted
rows to the usual body:

```json
{"ok":true,"deleted":12}
```

`deleted` is `0` on a quiet day, which is normal. `cleanup` is **not** watched by
`heartbeat-check`: a daily job would always look overdue under the five minute
rule. Its heartbeat row is still written on every run, so a run that stopped
happening is visible in `public.cron_heartbeats`.

Planned for later, **not implemented yet**: `reconcile-pending` every 10 minutes,
`expire-orders` hourly, `approve-commissions` hourly, `rollups` hourly,
`reconcile-daily` at 02:00, `vat-reminders` on the 14th and 19th at 09:00,
`payout-run` weekly. Do not add these to the scheduler until the job exists: the
endpoint answers 404 for an unknown name.

## cron-job.org settings

Create one cron job per row in the table above, with these settings:

- **URL**: `https://<app host>/api/cron/process-queue` (or the job name)
- **Method**: `POST`
- **Headers**: `Authorization` = `Bearer <CRON_SECRET>`
- **Schedule**: every minute / every 5 minutes
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
| Cleanup finished                  | 200    | `{"ok":true,"deleted":n}`                                |
| Missing or wrong secret           | 401    | `{"error":"unauthorized"}`                              |
| Unknown job name                  | 404    | `{"error":"not_found"}`                                 |
| Unexpected failure                | 500    | `{"ok":false}`                                          |

A single job failing is **not** a failed run: the job is marked failed (or
rescheduled) in the database and the request still answers 200 with the counts.
Only an unexpected exception returns 500. No response ever contains a secret or
error text.

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

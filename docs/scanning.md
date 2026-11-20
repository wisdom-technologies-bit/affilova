# Malware scanning

Every file a vendor uploads is scanned before it can be sold. Nothing else in the
product flow depends on it going right, which is why the rule is absolute:

> A file must be **clean** before its product can be submitted for review, and
> before any buyer can download it.

That rule is enforced in the database, not in a screen. `get_product_readiness`
reports a missing `scan` item while any file is not clean, `product_transition`
refuses both `submit` and staff `approve` with `not_ready`, and
`log_product_file_admin_access` refuses an `infected` or `rejected` file. A
screen can therefore be wrong, out of date or bypassed, and the rule still holds.

## Who does what

| Who | Does |
| --- | --- |
| **Vendor** | Uploads a file. Sees a label per file: waiting, scanning, clean, or the reason it was refused. Cannot submit until every file is clean. |
| **App** | Queues a scan the moment an upload is confirmed, presigns a 30 minute download link, and calls the scanner. |
| **Scanner** (separate service) | Downloads the object, scans it, and calls the app back with a signed verdict. |
| **Sweeper** (`scan-sweep`) | Every five minutes: queues a scan for anything new, failed, stale or due a weekly rescan. |
| **Staff** | Reads the verdict on a file. May decide a file that is `needs_review` or `error`. May never overrule `infected`. |

## The state machine

`product_files.scan_status` has eight values and moves only through the
functions below.

```
                   (upload confirmed)
 not_scanned ──────────────────────────► queued ──────► scanning
      ▲                                    │               │
      │ (scan_attempts >= 5)               │               │
      │                                    ▼               ▼
      └──────────────── error ◄──── (request refused)   callback
                                             ▲               │
                                             │               ├──► clean
                                             │               ├──► infected
                                             │               ├──► rejected
                                             └───────────────┴──► needs_review
                                                                 │
                                                      staff decides
                                                    clean ─┴─ reject
```

- `not_scanned`: uploaded, never scanned. The only state an upload can be in.
- `queued`: a scan id exists (`current_scan_id`) and the scanner has not
  answered yet. A stale `queued` (older than `scan_stale_minutes`, 30 by
  default) is picked up again by the sweeper.
- `scanning`: the scanner accepted the request and is working on it. Same
  staleness rule.
- `clean`: the only state that unlocks the product.
- `infected`: malware. The object is copied to `quarantine/<key>` and deleted
  from its live key, the product is paused if it was live, and the vendor takes
  a strike.
- `rejected`: the file is not malware, but it is not acceptable: a content and
  extension mismatch, an encrypted archive, archive limits, unsafe paths, a
  symlink, an executable type, or an incomplete upload. The product is paused if
  it was live.
- `needs_review`: the scanner could not decide alone, for example an archive
  that contains an executable. A member of staff decides.
- `error`: the scan itself failed (download, scanner error, timeout). The
  sweeper retries until five attempts, and staff may also decide it.

A result for a scan id that is no longer the file's `current_scan_id` is stale
and is ignored: a slow scan cannot overwrite a newer verdict. A repeated
callback for the same scan id is a duplicate and changes nothing, because
`file_scan_events.scan_id` is unique.

## What the scanner sends

The app calls `POST {SCANNER_URL}/scan` with a bearer token
(`SCANNER_SHARED_SECRET`) and a JSON body:

```json
{
  "scanId": "uuid",
  "fileId": "uuid",
  "downloadUrl": "https://...",
  "expectedSizeBytes": 4096,
  "extension": "pdf",
  "callbackUrl": "https://<app host>/api/internal/scan-result"
}
```

`202` means accepted; `429` and `503` (and a network failure) mean try again
later, so the job is retried with backoff; `400` and `401` mean the scanner will
never accept this request, so an `error` result is recorded instead of retrying
forever.

The scanner answers with `POST` to the callback URL. It carries
`X-Scanner-Timestamp` (unix seconds) and `X-Scanner-Signature`, which is the hex
HMAC-SHA256 of `` `${timestamp}.${rawBody}` `` under
`SCANNER_CALLBACK_SECRET`. The verdict is one of `clean`, `infected`,
`rejected`, `needs_review`, `error`, with a `detail` code of at most 300
characters, plus `sha256`, `detectedMime`, `engine`, `signatureVersion` and
`scannedAt`.

The callback route (`app/api/internal/scan-result`) is the only unauthenticated
write in the app. It is protected by that signature, not by a cookie:

- a bad signature, a missing signature or a timestamp more than five minutes
  from now is answered `401` with an **empty** body, so a caller learns nothing;
- a body over 16 KB is `413`, malformed JSON is `400`;
- a valid callback is always `200 {"ok":true}`, including a duplicate and a
  stale scan id, so the scanner has no reason to retry a decision already made;
- a rate limit of 600 per minute per client is applied, and a rate-limit failure
  **allows** the callback: a database hiccup must not drop a malware verdict.

## What happens on an infection

1. `record_scan_result` sets the file to `infected`, stores the detail (the
   signature name, cut to 300 characters), the SHA-256, the MIME type, the engine
   and the time, and writes `file.scan.infected` to `audit_log`.
2. If the product was `live`, it is set to `paused`, with
   `product.auto_paused_scan` in the audit log. A buyer's download stops because
   the download function only serves a file from a live product.
3. It counts the vendor's infected files in the last 30 days. When the count
   reaches `scan_infection_suspend_threshold` (2 by default), `vendor_profiles`
   is set to `suspended` and **all** of that vendor's live products are paused,
   with `vendor.auto_suspended_scan` in the audit log.
4. The route queues a `quarantine_file` job, which copies the object to
   `quarantine/<key>` and then deletes the original. The copy is a job rather
   than part of the callback so that a storage hiccup cannot fail the answer the
   scanner is waiting on; a failed copy is logged and retried.
5. The infection is logged at error level with the file id, the verdict and the
   detail code only. No URL, no hash, no secret. Sentry is configured to alert on
   that line.

The vendor sees "Rejected: malware detected" and cannot submit the product. The
file is not deleted, because deleting evidence of malware is worse than keeping
it: the row and its quarantine copy stay for staff.

## The weekly rescan

Signatures change; a file that was clean last month may not be clean today.
`list_files_due_for_scan` returns any `clean` file whose `scanned_at` is older
than `scan_rescan_days` (7 by default) when its product is `live`, `paused` or
`submitted`, and the sweeper queues it again. A file that fails its rescan goes
through the infection path exactly as an upload does: paused product, strike,
possible suspension.

## The vendor's view

While any file is `queued` or `scanning`, the product screen asks
`getFileScanStatusesAction` every five seconds and stops as soon as nothing is
pending, or when the page is left. The label is always words, never a colour
alone, and it is a live region so a screen reader hears the change:

| Status | What the vendor reads |
| --- | --- |
| `queued` | Waiting for security scan |
| `scanning` | Scanning |
| `clean` | Clean |
| `infected` | Rejected: malware detected |
| `rejected` | Rejected: this file type or content is not allowed, then the plain-language reason |
| `needs_review` | Under manual review |
| `error` | Scan failed, retrying |

The reason line is written for a vendor, from the detail code: the content does
not match the extension, password-protected archives are not accepted, the
archive is too large or too deeply nested, the archive contains unsafe paths,
program files are not accepted, the upload was incomplete. A signature name is
never shown to a vendor; it is a fact for staff.

## The staff's view

The review screen shows every file's scan state and its detail. A file that is
`infected` or `rejected` cannot be downloaded for inspection at all, and the
button is replaced by the reason. A file that is `needs_review` or `error` can be
decided with **Mark clean** or **Reject**, with a reason of at least ten
characters and a confirmation step; the decision is written to the audit log as
`file.scan.manual_clean` or `file.scan.manual_reject`.

An `infected` verdict is never reviewable. There is no "mark clean" for malware,
in the screen or in the database function.

## Self-test

The admin app has a **Security** page with one button that proves the chain works
without touching a product. It is the first thing to press after a deployment,
after a scanner upgrade, after a Bouncer key rotation, or whenever someone asks
"is scanning actually working?".

The page also shows, above the button: whether the scanner answers, the engine it
runs (**Bouncer**), and "Signature age: not applicable" (the engine is external
and keeps its own detection data, so there is no signature age to read), the
count of files in each scan status, how long the oldest waiting file has waited,
the background queue with a heartbeat per cron job, and the last twenty verdicts
(no file names, no vendors).

**What it does.** It builds four files in memory, writes them to the bucket under
`selftest/<uuid>/`, presigns a five minute GET URL for each, and calls the
scanner's `POST /selftest` once per file, in turn. The scanner runs the same
pipeline a real scan runs: it downloads with the size cap, detects the real type,
applies the MIME policy, the archive policy and Bouncer, and cleans up its temp
files. There is no callback. The page compares each answer to what that sample
must produce and shows Passed or Failed per row. Every object is deleted in a
`finally` block, whatever happened.

| Sample | What it is | Must answer |
| --- | --- | --- |
| `hello.txt` | The text "Affilova scanner self-test" | `clean` |
| `eicar.txt` | The standard EICAR test string, assembled from two halves in code so the repository never contains the literal | `infected`, with the threat name Bouncer returns for EICAR |
| `not-a-pdf.pdf` | A minimal PE executable named `.pdf` | `rejected`, detail `executable_type` |
| `archive.zip` | A valid stored zip generated in code, holding `run.exe` | `needs_review`, detail `archive_contains_executable` |

**What it proves.** The app can reach the bucket and presign a URL; the scanner
is up, authenticated and reachable from the app; it can fetch from R2; its type
detection, MIME policy, archive policy and Bouncer all work; and each policy
answers with the verdict and detail code the rest of the app depends on.

**What it does not prove.** It does not exercise the callback: no result is
signed, sent or verified, and no `file_scan_events` row is written. It does not
exercise the database state machine, the gates that block submission and download
before a `clean` verdict, the quarantine copy, or the weekly rescan. It also does
not prove that a real upload's bytes are what the scanner sees: the samples are
built here, not uploaded by a browser.

To test those, upload real files in a draft product: one harmless file, and (only
in staging) one EICAR file. That path goes through the browser upload, the signed
PUT, the `scan_file` job, the signed callback, `record_scan_result` and the
gates.

**Rules.** The button is admin only. It is rate limited to five runs an hour per
person, counted in Postgres, and the limiter denies rather than allows when it
cannot count. Each run writes one `audit_log` row, `ops.scanner_selftest`, with
the pass and fail counts and nothing else: no sample names, no verdicts, no URLs.
The signed URLs the self-test creates are never logged or returned to the browser.

## Runbook

**The scanner is down.** Uploads still work. Files stay `not_scanned` and then
`queued`, the vendor sees "Waiting for security scan", and the product cannot be
submitted. Nothing is lost: the sweeper retries every five minutes and stops
trying a file after five failed attempts, which leaves it in `error` for staff.
When the scanner is back, the queued files scan on the next sweep. Do not lower
`scan_required`.

**Every scan comes back `error` with `scanner_error`.** The engine is Bouncer, an
external API, so the usual cause is a rejected, expired or unset
`BOUNCER_API_KEY`, or a Bouncer outage. Check the scanner's logs and the Bouncer
dashboard before touching the app: the app only sees the verdict. Files stay
`queued` or `error` and the sweeper retries them, so nothing is lost while the
key is fixed. `/healthz` only proves the service is configured and listening; the
Security page's self-test is what proves Bouncer is actually answering.

**A file is refused as too large.** The engine accepts at most 25 MB per file,
and the app refuses anything larger at upload time with `too_large` before it is
stored. If a vendor needs a bigger file, that is a product decision: raise
`PROVIDER_SCAN_LIMIT_BYTES` in `lib/catalog/files.ts` and the provider plan
together, not just the app.

**A false positive.** An admin cannot clear an infected verdict, by design.
Ask the vendor to upload a new file (a new row, a new scan id, a new verdict), or
ask Bouncer to review a detection it reported wrongly. If the file
genuinely needs to ship, it needs a clean file, not an override.

**A vendor is suspended by the threshold.** Two infected files within 30 days
suspend the vendor and pause their live products. Staff restore the vendor in the
admin dashboard, product by product; nothing about the scan states changes.

**The callback route answers 401.** Check that `SCANNER_CALLBACK_SECRET` is the
same on both sides and that the scanner signs the raw body, not a re-serialised
one. Check the clock: a timestamp more than five minutes off is refused, and the
answer is empty on purpose, so look at `scan_callback_rejected` in the logs for
the reason.

## Returning to ClamAV

ClamAV is parked, not deleted: the module, its tests and its two config files are
under `services/scanner/archive/clamav/`, out of the suite and the typecheck. If
it is funded again, the steps are in
`services/scanner/archive/clamav/README.md` and in the "Returning to ClamAV"
section of `docs/scanning-contract.md`. The short version: move the files back,
re-add the `#clamav` import, point the pipeline at it, install and start `clamd`
in the image, restore the signature age on `/healthz` and this page, and revisit
the 25 MB limit that Bouncer forced.

## Environment variables

| Variable | What it is |
| --- | --- |
| `SCANNER_URL` | The scanner's base URL. The app calls `POST <url>/scan`. |
| `SCANNER_SHARED_SECRET` | At least 32 characters. Sent as `Authorization: Bearer …` on every scan request. |
| `SCANNER_CALLBACK_SECRET` | At least 32 characters. The HMAC key that signs every callback. |

The scanner service itself also needs `BOUNCER_API_KEY`, the key it sends to the
malware engine. It is not an app variable and the app never sees it.

All three app variables are read through `lib/env.ts` and validated lazily: importing the
module fails nothing, and a missing variable fails the job that needs it rather
than the build. None of them is ever logged, returned in a response, or sent to
the browser. The signed download URL the app gives the scanner is never logged
either: only the fact that a scan was requested.

## Where the code is

| Path | What it does |
| --- | --- |
| `supabase/migrations/20261115000100_malware_scanning.sql` | The tables, columns, functions and gates. |
| `supabase/verify/20261115000100_malware_scanning_verify.sql` | 23 checks that the migration did what it says. |
| `lib/env.ts` | `getScannerEnv()`. |
| `lib/scanning/signature.ts` | `signCallback` and `verifyCallback`, with a constant-time comparison. |
| `lib/scanning/client.ts` | `requestScan`, with a ten second timeout. |
| `lib/scanning/quarantine.ts` | `moveToQuarantine`: copy, then delete. |
| `lib/scanning/jobs.ts` | `scan_file`, `scan_sweep` and `quarantine_file`. |
| `app/api/internal/scan-result/route.ts` | The signed callback. |
| `app/api/cron/[job]/route.ts` | The `scan-sweep` schedule. |
| `lib/catalog/actions/vendor.ts` | Queues the scan on upload, and the status polling. |
| `lib/catalog/actions/admin.ts` | `reviewFileScanAction`. |
| `supabase/migrations/20261116000100_ops_overview.sql` | `scan_overview`, `job_overview` and `list_recent_scan_events`, read-only and service_role only. |
| `supabase/verify/20261116000100_ops_overview_verify.sql` | 11 checks that the ops migration did what it says. |
| `lib/ops/selftest-samples.ts` | The four samples, built in memory, and what each must produce. |
| `lib/ops/scanner-selftest.ts` | `runScannerSelfTest`: upload, presign, call `POST /selftest`, compare, delete. |
| `lib/ops/actions.ts` | `getSecurityOverviewAction` and `runScannerSelfTestAction`. |
| `components/ops/security-panel.tsx` | The Security page body and the button. |
| `app/hosts/admin/security/page.tsx` | The page itself. |

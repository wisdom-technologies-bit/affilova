# Scanner service

A standalone malware scanner for files uploaded to Affilova. The app posts a
private object URL, the service downloads it, decides whether it is safe, and
posts the verdict back to the app on a signed callback.

Malware detection is done by the external [Bouncer](https://usebouncer.dev) API.
The service keeps no detection engine of its own, so it needs no signature
database, no daemon and no large instance. ClamAV was the previous engine and is
parked under [`archive/clamav/`](archive/clamav/README.md) in case it comes back.

The wire contract lives in [`docs/scanning-contract.md`](../../docs/scanning-contract.md).

## What it does

1. `POST /scan` with a signed-in request is accepted into a bounded in-memory queue.
2. The object is streamed from storage to `/data/tmp/<scanId>` while its SHA-256
   is computed, aborting as soon as the byte count leaves the expected range.
3. `file --mime-type -b` decides what the bytes really are and the extension
   policy compares the two.
4. Archives (`zip`, `7z`, `rar`, and the zip-based `docx`, `xlsx`, `pptx`, `epub`)
   are listed with `7z l -slt` and checked for encryption, traversal, symlinks,
   limits and bundled executables.
5. The file is uploaded to Bouncer, which answers `clean`, `malicious` or
   `suspicious`. A file over the 25 MB provider limit never leaves the host: it
   is `rejected` with `provider_file_too_large`.
6. The temporary file is deleted on every path, including timeouts, and the
   signed verdict is posted back to the app.

## The engine

Bouncer is an HTTP API, and the service maps its answer onto the contract like
this:

| Bouncer | Verdict | Detail |
| --- | --- | --- |
| `clean` | `clean` | `clean` |
| `malicious` | `infected` | the threat names it returned, up to five, cut to 300 characters |
| `suspicious` | `needs_review` | the reason it returned |
| `failed`, or any other status | `error` | `scanner_error` |
| any verdict the service does not recognise | `error` | `scanner_error` |
| no answer inside the budget | `error` | `timeout` |

An unknown verdict is **never** `clean`. That rule is the reason the mapping is a
small explicit table instead of a boolean.

Two transports are used: files up to 4.5 MB go in one multipart `POST /v1/scan`;
larger files get an upload target from `POST /v2/scan`, are uploaded to it, and
are then polled until the scan finishes. The upload target must be HTTPS on an
`amazonaws.com` host and the polling URL must be on the Bouncer origin, both with
redirects refused, so a bad or hostile answer from the provider cannot be turned
into a request somewhere else.

`engine` in the callback is always `"bouncer"` and `signatureVersion` is always
`null`: Bouncer keeps its own detection data and does not expose a version.

## What it does NOT do

* It cannot guarantee that a file is free of malware. Bouncer only detects what
  it knows, the heuristics can miss new or obfuscated samples, and the archive
  rules only look one level deep. `clean` means "nothing known was found in the
  time budget", not "safe".
* It does not sandbox, execute or detonate files.
* It does not repair or rewrite files, and it never returns the file to the app.
* It does not store results. The verdict lives only in the callback; if every
  retry fails, the app's sweeper is responsible for catching up.
* It does not read encrypted archives. They are rejected, never inspected.
* It cannot list RAR5 archives (see below), so those come back as
  `needs_review` / `archive_unlistable` and need a human.
* It cannot scan a file over 25 MB. The app refuses those before upload.

## Requirements

* Node 24 or newer. The sources are TypeScript and run directly through Node's
  type stripping, so there is **no build step and no npm dependency**. There is
  no `node_modules`.
* 7-Zip (`p7zip-full`) and libmagic (`file`). The `Dockerfile` installs both.
* A Bouncer API key. Without `BOUNCER_API_KEY` the service refuses to start.
* No persistent disk and no signature database. `/data/tmp` only needs room for
  the file being scanned.

## Local development

```sh
sudo apt-get install -y p7zip-full libmagic1 file
sudo mkdir -p /data/tmp

SCANNER_SHARED_SECRET="$(openssl rand -hex 32)" \
SCANNER_CALLBACK_SECRET="$(openssl rand -hex 32)" \
BOUNCER_API_KEY="your-bouncer-key" \
ALLOWED_CALLBACK_ORIGINS="https://app.affilova.com" \
node src/server.ts
```

`GET /healthz` answers `200 {"ok":true,"engine":"bouncer"}`. There is no
signature age: Bouncer keeps its own detection data.

The tests are part of the repository suite and run with the root Vitest. They
never touch the network: every test injects a fake `scanFile`, so the suite runs
with no Bouncer key and no API quota:

```sh
pnpm test
pnpm typecheck:ratchet
```

## Configuration

The service refuses to start when a required variable is missing or malformed,
and the error names the variable.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `PORT` | no | `10000` | HTTP port |
| `SCANNER_SHARED_SECRET` | **yes** | – | at least 32 characters; the `Authorization: Bearer` value the app sends |
| `SCANNER_CALLBACK_SECRET` | **yes** | – | at least 32 characters; the HMAC key for callbacks |
| `BOUNCER_API_KEY` | **yes** | – | the `X-API-Key` sent to Bouncer; never logged |
| `ALLOWED_CALLBACK_ORIGINS` | **yes** | – | comma separated https origins, e.g. `https://app.affilova.com` |
| `ALLOWED_DOWNLOAD_HOST_SUFFIX` | no | `.r2.cloudflarestorage.com` | the storage host suffix the download URL must end with |
| `MAX_FILE_BYTES` | no | `2147483648` | download ceiling for one object; does not raise Bouncer's 25 MB limit |
| `WORK_DIR` | no | `/data/tmp` | scratch space, emptied on start |
| `CONCURRENCY` | no | `2` | jobs scanned at once |
| `QUEUE_LIMIT` | no | `100` | jobs allowed to wait; beyond this `POST /scan` answers 429 |

Two secrets, both 32+ random bytes, never logged, never returned, plus the
Bouncer key, which is treated the same way.

## Deploying on Render

1. In the Render dashboard choose **New → Web Service**.
2. **Connect a repository** and pick the Affilova GitHub repository, then the
   branch you deploy from.
3. Set **Runtime** to **Docker**. This service does not use a buildpack.
4. Set **Root Directory** to `services/scanner`.
5. Set **Dockerfile Path** to `Dockerfile` (it resolves inside the root
   directory above).
6. A small instance is enough: the engine is remote, so there is no signature
   database to hold in memory. 512 MB works for the default concurrency.
7. No persistent disk is needed. `/data/tmp` holds one file per in-flight scan.
8. Set the **Health Check Path** to `/healthz`.
9. Add the environment variables:

   | Key | Value |
   | --- | --- |
   | `SCANNER_SHARED_SECRET` | 32+ random characters, shared with the app |
   | `SCANNER_CALLBACK_SECRET` | 32+ random characters, shared with the app |
   | `BOUNCER_API_KEY` | the key from the Bouncer dashboard |
   | `ALLOWED_CALLBACK_ORIGINS` | `https://app.affilova.com` (add staging origins comma separated) |
   | `ALLOWED_DOWNLOAD_HOST_SUFFIX` | leave unset for `.r2.cloudflarestorage.com` |
   | `CONCURRENCY` | `2` |
   | `QUEUE_LIMIT` | `100` |

10. Deploy. The health check turns green as soon as the process is listening:
    there is nothing to download on first boot.
11. Point the app at the service URL and run one real upload end to end before
    opening the feature to vendors.

### Rotating the secrets

`SCANNER_SHARED_SECRET` and `SCANNER_CALLBACK_SECRET` are the only shared values
between the app and this service. Rotate them one at a time, and only during a
window where no scan is in flight (a callback sent with the old key is rejected
by the app and retried, but the app should not be mid-deploy anyway).

1. Generate a new value: `openssl rand -hex 32`.
2. Update it in **both** places in the same change: the app's environment and
   this service's environment on Render.
3. Redeploy the service (Render restarts it), then deploy the app.
4. Confirm `GET /healthz` is still `200` and run one real scan end to end.

Rotating `SCANNER_SHARED_SECRET` invalidates every request signed with the old
value, so a mismatch shows up as `401` in the app logs. Rotating
`SCANNER_CALLBACK_SECRET` shows up as rejected callbacks in the app logs
(`401`/`400` from `/api/internal/scan-result`). Keep a note of which value is
live; the service also fails to start if either value is under 32 characters.

`BOUNCER_API_KEY` is independent of the app. Rotate it in the Bouncer dashboard
and in this service's environment in one change, then redeploy. A wrong key shows
up as `scanner_error` on every scan, not as a startup failure, so run one real
scan after rotating.

## Deploying on Railway

The same image works unchanged.

1. **New Project → Deploy from GitHub repo**, pick the repository.
2. Set **Root Directory** to `services/scanner` so Railway builds that Dockerfile.
3. A small instance is enough. No volume is required.
4. Add the same environment variables as above.
5. Set the health check path to `/healthz` (Settings → Deploy → Healthcheck Path).
6. Deploy and confirm `/healthz` returns `200`.

### First boot

The server binds within a second and reports `200` on `/healthz` immediately.
Nothing has to be downloaded, so a cold deploy is ready in seconds. Keep one
instance: the queue is in memory.

## Deploying on Fly.io

```sh
cd services/scanner
fly launch --dockerfile Dockerfile --no-deploy

fly secrets set \
  SCANNER_SHARED_SECRET="$(openssl rand -hex 32)" \
  SCANNER_CALLBACK_SECRET="$(openssl rand -hex 32)" \
  BOUNCER_API_KEY="your-bouncer-key" \
  ALLOWED_CALLBACK_ORIGINS="https://app.affilova.com"

# a small machine is enough now that the engine is remote
fly scale vm shared-cpu-1x --memory 512
fly deploy
```

Set the health check to `GET /healthz` in `fly.toml`:

```toml
[[http_service.checks]]
  path = "/healthz"
  interval = "30s"
  timeout = "5s"
  grace_period = "30s"
```

More than one machine per region gains nothing: the queue is in memory.

## Operational notes

* **Health means configured.** `/healthz` is `200` when the process is listening
  and `BOUNCER_API_KEY` is set. It does not call Bouncer on every health check;
  the one-click self-test on the admin Security page is what proves the provider
  is reachable and answering.
* **Bouncer is a dependency and a cost.** Every scan is a billable call. A
  Bouncer outage shows up as `error` / `scanner_error`. The service does not
  retry a whole scan: the app's sweeper queues it again on its next pass, which
  is why a provider outage costs a scan attempt rather than a stuck file.
* **25 MB is the hard ceiling.** Files above it are `rejected` /
  `provider_file_too_large` before any bytes are sent. The app refuses them at
  upload with `too_large`, using `PROVIDER_SCAN_LIMIT_BYTES` in
  `lib/catalog/files.ts`, which must equal `BOUNCER_MAX_FILE_BYTES` here.
* **RAR.** `p7zip-rar` is in Debian non-free and is not installed, so RAR5
  archives cannot be listed and are reported as
  `needs_review` / `archive_unlistable`. RAR4 usually lists and is checked
  normally.
* **Timeouts.** One scan has 5 minutes with Bouncer (20 seconds in a self-test)
  inside a 20 minute job budget. A timeout is `error` / `timeout` and is
  retryable.

## Files

| File | Purpose |
| --- | --- |
| `src/server.ts` | HTTP surface: `POST /scan`, `POST /selftest`, `GET /healthz`, wiring and shutdown |
| `src/config.ts` | environment parsing and validation |
| `src/auth.ts` | constant time bearer check |
| `src/signature.ts` | callback HMAC |
| `src/url-guard.ts` | SSRF guards for the download and callback URLs |
| `src/queue.ts` | bounded queue, graceful shutdown, work directory cleanup |
| `src/scan-runner.ts` | the per job pipeline |
| `src/download.ts` | streaming download, SHA-256, size limits |
| `src/mime-policy.ts` | extension to detected MIME table and deny list |
| `src/archive-policy.ts` | `7z l -slt` parsing and archive rules |
| `src/bouncer.ts` | the Bouncer client: upload, poll, verdict mapping, size limit |
| `src/callback.ts` | signed callback with the retry schedule |
| `src/exec.ts` | shell-free child process helper |
| `src/log.ts` | JSON line logging with a key filter |
| `archive/clamav/` | the parked ClamAV engine, its tests, its configs and a restore guide |
| `package.json` | module resolution only: zero dependencies |

TypeScript uses `#`-prefixed subpath imports (`#config`, `#bouncer`, ...) because
Node's type stripping needs an explicit `.ts` extension while the repository's
`tsconfig.json` rejects `.ts` import paths. The `imports` map in `package.json`
satisfies both, and Vitest resolves it too.

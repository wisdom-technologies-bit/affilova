# Scanner service

A standalone malware scanner for files uploaded to Affilova. The app posts a
private object URL, the service downloads it, decides whether it is safe, and
posts the verdict back to the app on a signed callback.

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
5. `clamdscan --no-summary --fdpass` scans the file with ClamAV.
6. The temporary file is deleted on every path, including timeouts, and the
   signed verdict is posted back to the app.

## What it does NOT do

* It cannot guarantee that a file is free of malware. ClamAV only detects what it
  has signatures for, the heuristics can miss new or obfuscated samples, and the
  archive rules only look one level deep. `clean` means "nothing known was found
  in the time budget", not "safe".
* It does not sandbox, execute or detonate files.
* It does not repair or rewrite files, and it never returns the file to the app.
* It does not store results. The verdict lives only in the callback; if every
  retry fails, the app's sweeper is responsible for catching up.
* It does not read encrypted archives. They are rejected, never inspected.
* It cannot list RAR5 archives (see below), so those come back as
  `needs_review` / `archive_unlistable` and need a human.

## Requirements

* Node 24 or newer. The sources are TypeScript and run directly through Node's
  type stripping, so there is **no build step and no npm dependency**. There is
  no `node_modules`.
* ClamAV (`clamd`, `clamdscan`, `freshclam`), 7-Zip (`p7zip-full`) and libmagic
  (`file`). The `Dockerfile` installs all of them.

## Local development

```sh
# signatures and the daemon (Debian/Ubuntu)
sudo apt-get install -y clamav clamav-daemon clamav-freshclam p7zip-full libmagic1 file
sudo mkdir -p /data/clamav /data/tmp /run/clamav
sudo chown -R clamav:clamav /data/clamav /run/clamav
sudo freshclam --datadir=/data/clamav
sudo clamd --config-file="$(pwd)/clamd.conf" &

# install the config where clamdscan looks for it
sudo cp clamd.conf /etc/clamav/clamd.conf
sudo cp freshclam.conf /etc/clamav/freshclam.conf

SCANNER_SHARED_SECRET="$(openssl rand -hex 32)" \
SCANNER_CALLBACK_SECRET="$(openssl rand -hex 32)" \
ALLOWED_CALLBACK_ORIGINS="https://app.affilova.com" \
node src/server.ts
```

`GET /healthz` should answer `200 {"ok":true,"clamd":true,"signatureAgeHours":N}`
once clamd is up.

The tests are part of the repository suite and run with the root Vitest:

```sh
pnpm test
pnpm typecheck:ratchet
```

## Configuration

The service refuses to start when a required variable is missing or malformed,
and the error names the variable.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `PORT` | no | `8080` | HTTP port |
| `SCANNER_SHARED_SECRET` | **yes** | – | at least 32 characters; the `Authorization: Bearer` value the app sends |
| `SCANNER_CALLBACK_SECRET` | **yes** | – | at least 32 characters; the HMAC key for callbacks |
| `ALLOWED_CALLBACK_ORIGINS` | **yes** | – | comma separated https origins, e.g. `https://app.affilova.com` |
| `ALLOWED_DOWNLOAD_HOST_SUFFIX` | no | `.r2.cloudflarestorage.com` | the storage host suffix the download URL must end with |
| `MAX_FILE_BYTES` | no | `2147483648` | hard ceiling for one object (2 GiB) |
| `WORK_DIR` | no | `/data/tmp` | scratch space, emptied on start |
| `CONCURRENCY` | no | `2` | jobs scanned at once |
| `QUEUE_LIMIT` | no | `100` | jobs allowed to wait; beyond this `POST /scan` answers 429 |

Two secrets, both 32+ random bytes, never logged, never returned.

## Deploying on Render

1. In the Render dashboard choose **New → Web Service**.
2. **Connect a repository** and pick the Affilova GitHub repository, then the
   branch you deploy from.
3. Set **Runtime** to **Docker**. This service does not use a buildpack.
4. Set **Root Directory** to `services/scanner`.
5. Set **Dockerfile Path** to `Dockerfile` (it resolves inside the root
   directory above).
6. Choose an instance with **at least 2 GB of RAM**. ClamAV holds the signature
   database in memory (roughly 1.2 GB resident with `DetectPUA` and the bytecode
   database loaded), so a 512 MB or 1 GB instance will be killed while scanning.
7. Add a **persistent disk** of **at least 10 GB** mounted at `/data`. The
   signature database alone is several hundred MB, and `/data/tmp` holds the file
   being scanned. Without the disk every deploy re-downloads the signatures and
   the health check fails for the first few minutes.
8. Set the **Health Check Path** to `/healthz`.
9. Add the environment variables:

   | Key | Value |
   | --- | --- |
   | `SCANNER_SHARED_SECRET` | 32+ random characters, shared with the app |
   | `SCANNER_CALLBACK_SECRET` | 32+ random characters, shared with the app |
   | `ALLOWED_CALLBACK_ORIGINS` | `https://app.affilova.com` (add staging origins comma separated) |
   | `ALLOWED_DOWNLOAD_HOST_SUFFIX` | leave unset for `.r2.cloudflarestorage.com` |
   | `MAX_FILE_BYTES` | leave unset for 2 GiB |
   | `CONCURRENCY` | `2` |
   | `QUEUE_LIMIT` | `100` |

10. Deploy. The first boot downloads the signature database, so allow a few
    minutes before the health check turns green; `start-period` in the
    `Dockerfile` health check already allows for that.
11. Point the app at the service URL and run one real upload end to end before
    opening the feature to vendors.

### Rotating the two secrets

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

## Deploying on Railway

The same image works unchanged.

1. **New Project → Deploy from GitHub repo**, pick the repository.
2. Set **Root Directory** to `services/scanner` so Railway builds that Dockerfile.
3. Give the service **at least 2 GB of RAM** and a **volume of at least 10 GB
   mounted at `/data`**.
4. Add the same environment variables as above.
5. Set the health check path to `/healthz` (Settings → Deploy → Healthcheck Path).
6. Deploy and confirm `/healthz` returns `200`.

## Deploying on Fly.io

```sh
cd services/scanner
fly launch --dockerfile Dockerfile --no-deploy

fly volumes create scanner_data --size 10
# attach it at /data in fly.toml: [mounts] source = "scanner_data" destination = "/data"

fly secrets set \
  SCANNER_SHARED_SECRET="$(openssl rand -hex 32)" \
  SCANNER_CALLBACK_SECRET="$(openssl rand -hex 32)" \
  ALLOWED_CALLBACK_ORIGINS="https://app.affilova.com"

# at least 2 GB of memory, and keep one machine so the queue stays coherent
fly scale vm shared-cpu-2x --memory 2048
fly deploy
```

Set the health check to `GET /healthz` in `fly.toml`:

```toml
[[http_service.checks]]
  path = "/healthz"
  interval = "30s"
  timeout = "5s"
  grace_period = "300s"
```

Fly needs the volume mounted at `/data` for the same reason as Render, and more
than one machine per region gains nothing: the queue is in memory.

## Operational notes

* **`clamdscan` and the socket.** `clamdscan` has no option for a socket path; it
  reads `/etc/clamav/clamd.conf`. The image installs this service's `clamd.conf`
  there so `clamdscan` talks to the `clamd` that the entrypoint started. If you
  change `LocalSocket`, change it in `clamd.conf` only; the image copies it.
* **RAR.** `p7zip-rar` is in Debian non-free and is not installed, so RAR5
  archives cannot be listed and are reported as
  `needs_review` / `archive_unlistable`. RAR4 usually lists and is checked
  normally.
* **Health means ready.** `/healthz` is only `200` when clamd answers `PING` and
  the signatures are younger than 72 hours. `entrypoint.sh` runs `freshclam` once
  if the database is missing or older than a day, then starts `freshclam` in
  daemon mode with `Checks 24`, so it refreshes hourly.
* **Shutdown.** On `SIGTERM` the queue stops accepting work, gives running jobs
  up to 60 seconds, drops the waiting list, clears `/data/tmp` and exits. The
  temporary directory is also emptied on start, which covers a hard kill.
* **Logging.** JSON lines carrying `scanId`, `fileId`, `verdict` and stage
  durations only. URLs, secrets, file names and file contents are never logged.
* **Scratch space.** A scan needs room for the object plus whatever `clamdscan`
  writes, so keep `/data` comfortably larger than `MAX_FILE_BYTES` times
  `CONCURRENCY`.

## Layout

| File | Purpose |
| --- | --- |
| `src/server.ts` | HTTP surface: `POST /scan`, `GET /healthz`, wiring and shutdown |
| `src/config.ts` | environment parsing and validation |
| `src/auth.ts` | constant time bearer check |
| `src/signature.ts` | callback HMAC |
| `src/url-guard.ts` | SSRF guards for the download and callback URLs |
| `src/queue.ts` | bounded queue, graceful shutdown, work directory cleanup |
| `src/scan-runner.ts` | the per job pipeline |
| `src/download.ts` | streaming download, SHA-256, size limits |
| `src/mime-policy.ts` | extension to detected MIME table and deny list |
| `src/archive-policy.ts` | `7z l -slt` parsing and archive rules |
| `src/clamav.ts` | clamdscan parsing, PING, signature age, engine info |
| `src/callback.ts` | signed callback with the retry schedule |
| `src/exec.ts` | shell-free child process helper |
| `src/log.ts` | JSON line logging with a key filter |
| `package.json` | module resolution only: zero dependencies |

TypeScript uses `#`-prefixed subpath imports (`#config`, `#clamav`, ...) because
Node's type stripping needs an explicit `.ts` extension while the repository's
`tsconfig.json` rejects `.ts` import paths. The `imports` map in `package.json`
satisfies both, and Vitest resolves it too.

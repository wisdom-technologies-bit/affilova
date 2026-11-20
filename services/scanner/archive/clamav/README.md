# Archived: ClamAV engine

This directory holds the ClamAV integration the scanner used before it moved to
the external [Bouncer](../../../src/bouncer.ts) API. It is **parked, not
deleted**: the engine may come back when the project can fund a ClamAV
deployment again, and the safety work in these files is still the reference for
how the local engine behaved.

| File | What it is |
| --- | --- |
| `clamav.ts` | the ClamAV module: `clamdscan` output parsing, encrypted/limit alert classification, `clamdscan --version` parsing, signature database age, the `clamd` `PING` probe and the readiness probe |
| `clamav.test.ts` | the module's tests, written against fake `clamdscan` output and a fake socket |
| `clamd.conf` | the `clamd` configuration the image used to install at `/etc/clamav/clamd.conf` |
| `freshclam.conf` | the `freshclam` configuration the image used to install at `/etc/clamav/freshclam.conf` |

Nothing here is imported by the running service. The files are excluded from the
test suite and from the typecheck (see `vitest.config.ts` and `tsconfig.json`),
so they cannot fail the build while they are archived. Their imports still use
the `#`-prefixed specifiers from `services/scanner/package.json`, which is why a
restore also has to put that map entry back.

## Why it was parked

ClamAV needs a daemon, a signature database of several hundred megabytes, at
least 2 GB of RAM and a persistent disk on the host. Bouncer is an HTTP API, so
the service now needs no engine of its own and can run on a small instance. The
trade is a 25 MB per-file provider limit and a per-scan cost.

## Returning to ClamAV

1. Move the module and its tests back next to the other sources:

   ```sh
   git mv services/scanner/archive/clamav/clamav.ts services/scanner/src/clamav.ts
   git mv services/scanner/archive/clamav/clamav.test.ts services/scanner/src/clamav.test.ts
   git mv services/scanner/archive/clamav/clamd.conf services/scanner/clamd.conf
   git mv services/scanner/archive/clamav/freshclam.conf services/scanner/freshclam.conf
   ```

2. Re-add the subpath import to `services/scanner/package.json`:

   ```json
   "#clamav": "./src/clamav.ts",
   ```

3. Restore the engine in the pipeline. `services/scanner/src/scan-runner.ts`
   takes the scan function from `PipelineDeps`, so the wiring changes in one
   place: pass `scanFile` from `#clamav` instead of `#bouncer`, and map
   `ClamavOutcome` back onto the payload (`infected` carries the signature name).
   `buildPayload` writes `engine: BOUNCER_ENGINE`; that becomes `PAYLOAD_ENGINE`
   from `#clamav`.

4. Restore the engine-specific safety behaviour in the tests. The Bouncer tests
   already cover the pipeline; the archived `clamav.test.ts` covers the engine
   itself. Both belong in the suite once the engine is live. Re-check that these
   rules are still asserted after the swap:
   - an unknown or unrecognised engine answer is an `error`, never `clean`
   - `Heuristics.Encrypted.*` and `Heuristics.ExceedsMax*` are rejections, not
     infections
   - a timeout is a `timeout`
   - the temporary file is deleted on every path

5. Put the engine back in the image and the deploy: install `clamav`,
   `clamav-daemon` and `clamav-freshclam` in `services/scanner/Dockerfile`,
   start `clamd` from `entrypoint.sh`, and give the host the RAM and the
   persistent disk `docs/scanning.md` describes. `/healthz` then reports the
   engine name and the signature age again, and the admin Security page can show
   a real signature age instead of "not applicable".

6. Update `docs/scanning-contract.md`, `docs/scanning.md`,
   `services/scanner/README.md` and the app's `docs/catalog.md` back from
   Bouncer to ClamAV, including the `engine` field value in the callback.

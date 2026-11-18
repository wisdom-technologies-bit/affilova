# Affilova scanner service.
#
# One container, no npm dependencies: Node 24 runs the TypeScript sources through
# type stripping, so there is no install or build step. ClamAV does the detection,
# 7-Zip lists archives and libmagic identifies the real file type.
#
# Build context is services/scanner, so the paths below are relative to it.

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080 \
    WORK_DIR=/data/tmp

# clamav        signature database and the libclamav engine
# clamav-daemon clamd, the long running scanner clamdscan talks to
# clamav-freshclam signature updates
# p7zip-full    `7z l -slt` archive listings
# libmagic1+file real file type detection
#
# RAR note: p7zip-rar lives in Debian non-free, which this base image does not
# enable, so RAR5 archives cannot be listed and are reported as
# needs_review / archive_unlistable rather than silently accepted.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        clamav \
        clamav-daemon \
        clamav-freshclam \
        p7zip-full \
        libmagic1 \
        file \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/tmp /data/clamav /run/clamav \
    && chown -R clamav:clamav /data/clamav /run/clamav \
    && chown -R node:node /data/tmp


# Bake the signature database into the image. A platform health check gives a new
# container about five minutes and then kills it, which is not enough time to pull
# the whole database on a cold volume: the container dies, the download starts
# over, and the deploy never succeeds. With the database in the image the first
# boot only has to copy it into the volume, and clamd is ready in seconds.
#
# The bake uses its own minimal config rather than anything the base image ships,
# so the result does not depend on that package's logging or directory defaults.
# It sits ahead of the source COPYs so editing the service does not re-download
# it, and a failed download is not fatal: the entrypoint falls back to fetching.
RUN mkdir -p /opt/clamav-db \
    && printf 'DatabaseDirectory /opt/clamav-db\nDatabaseMirror database.clamav.net\nChecks 1\n' > /tmp/bake.conf \
    && (freshclam --config-file=/tmp/bake.conf || echo "warning: no baked signatures") \
    && rm -f /tmp/bake.conf

WORKDIR /app/services/scanner

COPY package.json ./
COPY src ./src
COPY clamd.conf freshclam.conf entrypoint.sh ./

# clamdscan, which the service spawns, has no option for a socket path: it reads
# the packaged /etc/clamav/clamd.conf. Installing our config there is what makes
# the scanner talk to the clamd started by the entrypoint instead of the
# package's default socket.
COPY clamd.conf /etc/clamav/clamd.conf
COPY freshclam.conf /etc/clamav/freshclam.conf

RUN chmod +x ./entrypoint.sh

# 8080 is the HTTP API; /data holds the signatures and the scratch space. Attach a
# Railway Volume mounted at /data so a redeploy does not re-download ~300 MB.
EXPOSE 8080

# Health is "clamd answers PING and the signatures are younger than 72 hours",
# which is exactly what /healthz reports.
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/services/scanner/entrypoint.sh"]

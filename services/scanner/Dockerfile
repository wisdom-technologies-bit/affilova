
# Affilova scanner service.
# Malware detection is handled by the external Bouncer API.
# 7-Zip and libmagic remain local for archive and file-type policies.

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    WORK_DIR=/data/tmp

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gosu \
        p7zip-full \
        libmagic1 \
        file \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/tmp \
    && chown -R node:node /data/tmp

WORKDIR /app/services/scanner

COPY package.json ./
COPY src ./src
COPY entrypoint.sh ./

RUN chmod +x ./entrypoint.sh

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||10000)+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/services/scanner/entrypoint.sh"]

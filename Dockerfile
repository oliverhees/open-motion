# syntax=docker/dockerfile:1
# Open Motion: one image, two variants.
#   target "slim"     editor + API + render worker, transcription via API providers
#   target "whisper"  same plus local faster-whisper (bigger image)
# The same image runs as editor (OPENMOTION_ROLE=app) or render worker (OPENMOTION_ROLE=worker).

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------- production dependencies only ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/render/package.json packages/render/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/editor/package.json packages/editor/package.json
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- build the editor ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/render/package.json packages/render/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/editor/package.json packages/editor/package.json
RUN npm ci --no-audit --no-fund
COPY packages ./packages
RUN npm run editor:build

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg tini ca-certificates \
      fonts-dejavu-core fonts-liberation fonts-noto-color-emoji \
      libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
      libexpat1 libx11-6 libxext6 libxcb1 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOME=/home/node \
    OPENMOTION_DATA=/data \
    OPENMOTION_REQUIRE_AUTH=1 \
    PORT=4317 \
    HYPERFRAMES_NO_TELEMETRY=1 \
    HYPERFRAMES_SKIP_SKILLS=1 \
    DO_NOT_TRACK=1
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages ./packages
COPY --chown=node:node examples ./examples
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node docs/motion-spec.md ./docs/motion-spec.md
COPY --from=build --chown=node:node /app/packages/editor/dist ./packages/editor/dist
RUN mkdir -p /data && chown node:node /data
USER node
# Chrome for rendering is baked into the image (no download at runtime).
RUN npx --no-install hyperframes browser ensure
EXPOSE 4317
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "packages/server/src/main.ts"]

FROM runtime AS slim

FROM runtime AS whisper
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --no-cache-dir --break-system-packages faster-whisper==1.1.1 requests==2.34.2
USER node

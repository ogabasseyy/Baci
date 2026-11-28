# Multi-stage rootless, read-only-rootfs Node 24 image for @baci/storefront-compiler.
# Build from monorepo root context:
#   docker build -f apps/storefront-compiler/Dockerfile -t baci-storefront-compiler .
# Executed under runsc (--network=none --read-only --user=65532:65532 --cap-drop=ALL)
# or Cloudflare Containers (basic / standard-1, enableInternet = false).

FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS builder

RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

WORKDIR /workspace

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY patches ./patches
COPY packages/shared ./packages/shared
COPY packages/experience-sdk ./packages/experience-sdk
COPY apps/storefront-compiler ./apps/storefront-compiler

RUN pnpm install --frozen-lockfile --filter @baci/storefront-compiler... && \
    pnpm --filter @baci/storefront-compiler build && \
    pnpm --filter @baci/storefront-compiler deploy --prod --legacy /opt/storefront-compiler && \
    cp -r apps/storefront-compiler/dist /opt/storefront-compiler/dist

FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS runtime

ENV NODE_ENV=production \
    LANG=C.UTF-8 \
    TZ=UTC

WORKDIR /opt/storefront-compiler

COPY --from=builder --chown=65532:65532 /opt/storefront-compiler /opt/storefront-compiler

RUN chmod -R a-w /opt/storefront-compiler

USER 65532:65532

ENTRYPOINT ["/usr/local/bin/node", "/opt/storefront-compiler/dist/cli.mjs"]

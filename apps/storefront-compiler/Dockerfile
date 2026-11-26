# Rootless, read-only-rootfs Node 24 image for @baci/storefront-compiler.
# Executed with --network=none --read-only --user=65532:65532 --cap-drop=ALL
# --security-opt=no-new-privileges (runsc/Docker) or Cloudflare Containers.
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    LANG=C.UTF-8 \
    TZ=UTC

WORKDIR /opt/storefront-compiler

COPY package.json ./package.json
COPY dist ./dist
COPY node_modules ./node_modules

RUN chown -R 65532:65532 /opt/storefront-compiler && \
    chmod -R a-w /opt/storefront-compiler

USER 65532:65532

ENTRYPOINT ["/usr/local/bin/node", "/opt/storefront-compiler/dist/cli.mjs"]

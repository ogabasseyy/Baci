# Hosted customer-draft Next standalone build recipe

## Status

This is a staging-only, owner-executed build and verification recipe. It makes no DNS, Vercel, VPS, Nginx, environment, or database changes. The existing Vercel PiggyVest receiver remains its independent deployment and is not routed through Next.

## Topology

`https://staging.ogabassey.com` remains the browser-facing Vercel origin. The parent-owned `customer-draft-proxy-routes.ts` supplies only these external rewrites to `https://staging-auth.ogabassey.com`:

- `/api/storefront/customer/savings/drafts`
- `/api/storefront/customer/savings/drafts/policy`
- `/api/storefront/customer/savings/drafts/catalogue`

The rewrites must not include `/api/webhooks/piggyvest` or a wildcard route. Therefore the Vercel receiver continues to own its existing raw-body/HMAC path and durable-store contract; webhook equivalence through a new proxy is neither claimed nor required.

The staging-auth VPS runs the regular Next application from its documented standalone artifact. It is not a replacement receiver or a hand-written HTTP/auth implementation. The user-visible request stays at the staging Vercel origin, while the backend request reaches the VPS standalone process.

## Conditional standalone output

`PIGGYVEST_HOSTED_DRAFT_STANDALONE_BUILD=true` is the sole opt-in build flag. When and only when it is exactly `true`, `apps/web/next.config.ts` adds `output: 'standalone'`. Its absence and every other value preserve the current configuration unchanged.

This flag is intentionally separate from `PIGGYVEST_HOSTED_DRAFT_STAGING_ENABLED=true`, which is the runtime authorization gate. `NODE_ENV=production` is an optimized build/runtime mode and never enables hosted drafts.

Next documents that standalone mode emits `.next/standalone/server.js` and that `public` plus `.next/static` must be copied into the standalone tree. See the official [Next output documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) and [self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting).

## Owner-run VPS recipe

This repository currently has dirty tracked savings implementation plus required
untracked source. `git archive HEAD` is therefore invalid for this topology: it
silently omits both dirty tracked content and the named untracked implementation.
Use the preparation CLI to produce a content-addressed working-tree snapshot
instead. It copies every tracked regular file from the current worktree, then
only the savings-specific untracked routes, libraries, schemas, standalone
configuration, tooling, and named new PiggyVest migrations. It excludes all
`.env*` files, `.next`, `.vercel`, `node_modules`, caches, Playwright state, and
all unrelated untracked artifacts. The resulting manifest records the base HEAD
revision and SHA-256 for every copied file.

1. From the reviewed source worktree, choose a destination outside the worktree
   and create the snapshot. Review the JSON manifest before transfer; it is the
   source receipt, not an environment receipt.

   ```bash
   pnpm --filter @baci/web exec tsx \
     tools/piggyvest-staging/customer-savings-draft-standalone-preparation-cli.ts \
     snapshot "$PWD" /srv/baci-staging-snapshots/customer-savings-draft
   ```

2. Transfer only that snapshot and its manifest to the isolated VPS build
   directory. Do not add an environment file to the snapshot or the transfer.
   The owner-managed staging credential mechanism must inject its reviewed
   values outside the source tree and must never echo them into logs or command
   lines.

3. Before install/build, record free disk and require at least 30 GiB free for
   this isolated build. Use Node 24 as required by `apps/web/package.json`, then
   run `pnpm install --frozen-lockfile --prefer-offline` in the snapshot. This
   is a normal pnpm dependency install, not a Vercel build.

4. Run the focused customer-draft tests, including the snapshot/preparation CLI
   tests, standalone-output helper test, parent-owned proxy-route test, and the
   existing draft-handler/runtime-gate tests.

5. Before using a systemd bound, the VPS owner must verify that the intended
   user service manager is reachable and accepts service properties. Do not
   assume that `systemd-run --user --scope` supports `RuntimeMaxSec`, and do
   not fall back to an unbounded shell if the user D-Bus is unavailable. The
   credential envelope must already be available to the verified service; do
   not pass secrets via command arguments. `PIGGYVEST_HOSTED_DRAFT_STANDALONE_BUILD=true`
   is the only build-specific override.

   ```bash
   systemctl --user show-environment >/dev/null
   systemd-run --user --collect --wait \
     -p Type=exec -p MemoryMax=8G -p CPUQuota=200% -p TasksMax=512 \
     -p RuntimeMaxSec=2700 /usr/bin/true
   systemd-run --user --collect --wait \
     -p Type=exec -p MemoryMax=8G -p CPUQuota=200% -p TasksMax=512 \
     -p RuntimeMaxSec=2700 \
     --working-directory=/srv/baci-staging-snapshots/customer-savings-draft \
     env NODE_OPTIONS=--max-old-space-size=7168 \
     PIGGYVEST_HOSTED_DRAFT_STANDALONE_BUILD=true \
     pnpm --filter @baci/web build:ci
   ```

   This is a conditional command: execute it only after the two preflight
   commands succeed on that VPS. It invokes the existing offline compile flow,
   `next build --experimental-build-mode=compile`; it never invokes
   `vercel build` or a cloud build.

6. Next's monorepo artifact server is
   `apps/web/.next/standalone/apps/web/server.js`, not
   `apps/web/.next/standalone/server.js`. Copy public/static assets and verify
   that exact nested layout with the preparation CLI:

   ```bash
   pnpm --filter @baci/web exec tsx \
     tools/piggyvest-staging/customer-savings-draft-standalone-preparation-cli.ts \
     prepare .next
   pnpm --filter @baci/web exec tsx \
     tools/piggyvest-staging/customer-savings-draft-standalone-preparation-cli.ts \
     verify .next/standalone
   ```

7. Start only on loopback from the nested app root, such as
   `cd apps/web/.next/standalone/apps/web && HOSTNAME=127.0.0.1 PORT=<reviewed-private-port> node server.js`.
   Do not expose that listener publicly.

## Reviewed runtime envelope gate

The `env.ts` export eagerly evaluates at import/build time. The approved
isolated profile is `BACI_WORKER_PROFILE=hosted-savings-drafts`; its dedicated
`hosted-draft-environment` schema is included in this snapshot with its tests.
It requires `NODE_ENV=production`,
`PIGGYVEST_HOSTED_DRAFT_STAGING_ENABLED=true`, the exact
`https://staging.ogabassey.com` app origin, the exact
`https://staging-auth.ogabassey.com` public Supabase origin, and the actual
staging public anon key. The route independently verifies that anon key against
its pinned SHA-256 before enabling hosted drafts.

This profile must contain no service role, JWT signing material, PiggyVest
secret, or payment-provider credential. It is intentionally limited to public
Supabase configuration; no fake value may be substituted to satisfy a schema.
The environment-profile review remains a separate gate from snapshot/build
preparation.

## Parent-owned ingress prerequisites

Before the three external rewrites are enabled, the parent must separately review and install exact-path ingress at `staging-auth.ogabassey.com`. It must accept only the intended Vercel-to-VPS traffic and must not route any non-draft path to Next.

The ingress must set a fixed trusted upstream `Host: staging.ogabassey.com` (and fixed HTTPS forwarding metadata where needed) when proxying to loopback Next. It must discard client-supplied forwarded-host/proto headers rather than trusting arbitrary values. This gives the regular Next request URL the exact origin required by the customer-draft runtime gate without treating a local URL as hosted.

The parent must verify the exact three paths for authenticated cookie/Bearer behavior, CSRF on writes, Zod validation, the synthetic merchant restriction, staging runtime pins, and denial on every mismatched origin/configuration. This server gate remains additional to, never a replacement for, the existing database binding.

## Explicit exclusions

- No DNS cutover and no change to the working Vercel receiver.
- No `proxy.ts`, migration, environment-file, production, Vercel, or remote-system change in this work.
- No service-role credentials, production secret copies, broad routes, wildcard rewrites, or handmade HTTP server.
- The rejected Vercel customer-draft artifact finalizer remains unshipped; it is not part of this topology.

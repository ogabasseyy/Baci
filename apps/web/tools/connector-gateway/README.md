# R1 Read-Only Connector Gateway (staging)

Deployable REST/OpenAPI gateway for the read-only R1 pilot. It reuses the
R0 C-prime sequence proven by the harness (`resolve_connector_grant_context`
→ `SET LOCAL ROLE authenticated` + jwt claims → scoped reads through RLS),
the manifest tool contract, and the stable `{ error, code }` taxonomy, and
adds what staging validation needs: a stable HTTPS base address, per-key +
per-IP rate limiting, and durable audit records.

Production traffic stays gated on the production-scope ADR-003 decision:
the server refuses `NODE_ENV=production` without
`CONNECTOR_GATEWAY_PRODUCTION_APPROVED=1`. Production configuration must not
include the staging-only grant-management credentials or fixed pilot owner and
merchant IDs. In production, `/v0/issue-token`, `/v0/refresh`, and
`/v0/revoke` return 404; merchant owners manage agent-specific grants through
the authenticated Baci Integrations API. The public tool routes resolve each
merchant and scope from its validated grant.

## Start

```sh
cd apps/web
CONNECTOR_GATEWAY_ENABLED=1 \
CONNECTOR_GATEWAY_DATABASE_URL='postgres://connector_gateway:<secret>@<host>:5432/<db>' \
CONNECTOR_GATEWAY_OWNER_SECRET='<32+ char random>' \
CONNECTOR_GATEWAY_OWNER_USER_ID='<pilot owner uuid>' \
CONNECTOR_GATEWAY_MERCHANT_ID='<pilot merchant uuid>' \
CONNECTOR_GATEWAY_PUBLIC_BASE_URL='https://connector.staging.example.com' \
../../node_modules/.bin/tsx tools/connector-gateway/server.ts
```

The command above is for local/staging validation. Production deployment must
use the separately reviewed host configuration and production database role;
do not copy the pilot owner credentials into a production environment.

Defaults: bind `127.0.0.1:3201` (`CONNECTOR_GATEWAY_HOST` /
`CONNECTOR_GATEWAY_PORT` override), 120 req/min/key + 600 req/min/IP over a
60s window (`CONNECTOR_GATEWAY_RATE_PER_KEY` / `_PER_IP` / `_WINDOW_MS`
override). The base URL must be `https://` (plain `http://` only for
loopback) and is advertised verbatim in `/openapi.json`. Behind the
local proxy, per-IP budgets read `X-Forwarded-For` only from socket
peers in `CONNECTOR_GATEWAY_TRUSTED_PROXIES` (default loopback);
forwarded headers from anyone else are ignored.

## Endpoints

| Method + path | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Liveness + DB reachability (`db: up/down`). |
| `GET /docs` | none | Public setup and access documentation for merchant owners and agent builders. |
| `GET /openapi.json` | none | OpenAPI 3.1 discovery: the four manifest tool paths only (credential endpoints stay undiscoverable). |
| `POST /v0/issue-token` | owner secret (Bearer) | Scoped issuance: `{ connection_id, branch_ids?, scopes?, merchant_wide?, expires_in_seconds? }` → `{ grant_id, token, refresh_token, expires_at }`. Tokens are returned once and never logged. |
| `POST /v0/refresh` | refresh token in body | Single-use rotation: `{ refresh_token }` → new pair. Scopes/branches/merchant binding are untouched, so refresh cannot expand authority. |
| `POST /v0/revoke` | owner secret (Bearer) | `{ grant_id }` → `{ revoked }`. Next call on the grant is denied. |
| `POST /v0/tools/orders.list` | connector token (Bearer) | Bounded order reads. Payment and shipping stay separate fields. |
| `POST /v0/tools/orders.get` | connector token (Bearer) | Single order read (`order_id` required; 404 when not visible in scope). |
| `POST /v0/tools/inventory.levels` | connector token (Bearer) | Per-(variant, branch) available/reserved/sold counts with low-stock flags. Optional `branch_ids` narrows the read. |
| `POST /v0/tools/analytics.summary` | connector token (Bearer) | Branch-scoped order aggregates (count, paid count + revenue, shipping breakdown) plus stock totals. Payment and shipping stay separate. |

Every error uses the stable shape `{ error, code }` with no internals:
401 (`GRANT_REVOKED`), 403 (`FORBIDDEN_SCOPE`, `BRANCH_NOT_ALLOWED`,
`ROLE_REMOVED`), 404/400/413 (`INVALID_REQUEST`), 429 (`RATE_LIMITED` +
`Retry-After`), 501 (`TOOL_UNAVAILABLE`), 500 (`UNKNOWN_OUTCOME`).

## Audit

Every connector request writes one row to `public.connector_gateway_audit` (migration
`20261003090000_connector_gateway_audit_r1.sql`): grant id when a grant
was resolved, route, status, latency. The table has no credential,
payload, or row-data columns, and the `toAuditEntry` allowlist drops
anything else before insert. A failing audit sink is reported on stderr
and never breaks the call. Liveness checks are excluded. Rejections are sampled: at most one 429 row
per client per window, so denied floods cannot become INSERT floods.

## Transport

Muse is cloud-hosted and cannot reach `127.0.0.1`. Expose only the
allowlisted paths through the Caddyfile in this directory (public
discovery + tools on `:3220`, everything owner-secret stays on
loopback `:3201`), then point the custom connector at
`<public-base>/openapi.json` with an issued token.

### Staging preflight (branch-only, per run)

URLs and credentials are single-run: the tunnel URL changes every run
and nothing persists between operator sessions.

1. Resume `baci-connector-r0-proof`; fetch its pooler URL into a 0600
   file (`supabase branches get --output json`, by branch id).
2. Fresh 0600 `gateway_password` + `owner_secret`; pooler psql as
   `postgres.<branch-ref>`:
   `ALTER ROLE connector_gateway WITH LOGIN PASSWORD '<fresh>';`
   (gateway pooler user: `connector_gateway.<branch-ref>`).
3. Start the gateway on `:3201` (`CONNECTOR_GATEWAY_*` env,
   `sslmode=require`), start Caddy (`:3220`), start
   `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3220`,
   then restart the gateway with
   `CONNECTOR_GATEWAY_PUBLIC_BASE_URL=<tunnel URL>`.
4. Verify from the public URL: `/openapi.json` 200 with 4 tool paths,
   tools 401 without auth, issue/refresh/revoke/health/unknown 404.
5. Issue a throwaway grant locally, exercise all four tools plus one
   denial, then revoke it. Issue one pilot grant per agent under
   test; each token goes only into that agent's secure prompt.
6. At pilot end: revoke pilot grants, `ALTER ROLE connector_gateway
   WITH NOLOGIN PASSWORD NULL`, stop all three processes, delete
   /tmp secrets, re-pause the branch.

## Production image preparation

From the repository root, run `pnpm --filter @baci/web build:connector-gateway`
before the Docker/Compose build. The generated `dist/server.js` includes only
the gateway and its runtime dependencies and stays out of Git. The production
image runs it directly with Node 24 as a non-root user; no monorepo dependency
installation happens in the image. `cli.test.ts` exercises the
standalone bundle's discovery and unauthenticated denial.

The protected runtime environment defaults to `/etc/baci/muse-connector.env`.
An operator without root access can set `CONNECTOR_GATEWAY_ENV_FILE` to a
mode-0600 file in the service user's private configuration directory. This
file holds the dedicated gateway database URL and production approval flag,
never a fixed merchant/owner credential. Keep it outside the source checkout.

## Runtime regression suite

`server.test.ts` provisions a disposable PostgreSQL cluster,
applies the committed fixture plus the real grants + audit migrations,
and drives this HTTP surface: discovery base address, order reads with
durable audit, per-key rate limiting with cross-key isolation, scope
denials, rotation, and revocation. It needs local `initdb`/`pg_ctl`/`psql`
binaries and skips with a warning when they are absent:

```sh
pnpm vitest run tools/connector-gateway/server.test.ts
```

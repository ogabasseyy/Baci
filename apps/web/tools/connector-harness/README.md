# R0 Connector Harness (test-only, never production)

Minimal isolated runtime for the R0 pilot proofs. It exercises the real
manifest, the real grant RPCs, and the real RLS policies over a direct
database connection (C-prime design). It is a standalone script outside
`src/app`, so it adds zero production routes.

## Start

```sh
cd apps/web
HARNESS_ENABLED=1 \
HARNESS_DATABASE_URL='postgres://connector_gateway:<secret>@<host>:5432/<db>' \
HARNESS_OWNER_SECRET='<32+ char random>' \
HARNESS_TEST_OWNER_USER_ID='<test owner uuid>' \
HARNESS_TEST_MERCHANT_ID='<test merchant uuid>' \
../../node_modules/.bin/tsx tools/connector-harness/server.ts
```

The server refuses to start when `NODE_ENV=production` or without
`HARNESS_ENABLED=1`, and binds `127.0.0.1:3101` by default
(`HARNESS_HOST` / `HARNESS_PORT` override).

## Endpoints

| Method + path | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Liveness + DB reachability (`db: up/down`). |
| `GET /openapi.json` | none | Real OpenAPI 3.1 discovery built from the manifest (`HARNESS_PUBLIC_BASE_URL` overrides `servers`). |
| `POST /v0/issue-token` | owner secret (Bearer) | Manual test issuance: `{ connection_id, branch_ids?, scopes?, merchant_wide?, expires_in_seconds? }` → `{ grant_id, token, refresh_token, expires_at }`. Tokens are returned once and never logged. |
| `POST /v0/refresh` | refresh token in body | Manual credential replacement: `{ refresh_token }` → new pair. This exercises rotation; it does not prove platform-driven refresh semantics. |
| `POST /v0/revoke` | owner secret (Bearer) | `{ grant_id }` → `{ revoked }`. |
| `POST /v0/tools/orders.list` | connector token (Bearer) | Bounded order reads. Body: manifest `orders.list` schema. |
| `POST /v0/tools/orders.get` | connector token (Bearer) | Single order read (`order_id` required; 404 when not visible in scope). |
| `POST /v0/tools/inventory.levels` | connector token (Bearer) | Stock levels per (variant, branch) with low/out-of-stock signals. Body: manifest `inventory.levels` schema; requires `inventory:read`. |
| `POST /v0/tools/analytics.summary` | connector token (Bearer) | Branch-scoped sales + stock aggregates; payment and shipping stay separate. Body: manifest `analytics.summary` schema; requires `analytics:read`. |

Denials use the stable connector shape `{ error, code }` with 401
(invalid/revoked/expired), 403 (scope/branch/permission), 404, 400/413
(bad body), 429 (120 req/min/IP), and 500 without internals.

## Reaching it from Muse

Muse is cloud-hosted and cannot reach `127.0.0.1`. Options:

1. Local proof (curl): run the server and exercise every endpoint above
   from the same machine. This is the R0 connectivity + authorization
   evidence an agent can produce.
2. Tunnel for interactive Muse setup: first run
   `caddy run --config tools/connector-harness/Caddyfile` from `apps/web`,
   then tunnel only the allowlist proxy, e.g. `ngrok http 3120`.
   Set `HARNESS_PUBLIC_BASE_URL` to the tunnel URL, and
   create the custom connector in Muse against
   `<tunnel>/openapi.json` with the issued token. Requires a user-held
   Muse account; browser-assisted setup may still need interactive auth.
3. Staging deploy: run the harness on an internal staging host against the
   isolated branch database (R1 provisioning).

## Regression suite

`server.test.ts` provisions a disposable PostgreSQL cluster,
applies `runtime-fixture.sql` plus the real R0 migration, and drives this
HTTP surface: successful reads for all four tools, merchant-selector
rejection, merchant-wide branch narrowing, tenant/branch containment,
denial shapes (401/403 with stable `{ error, code }`), rotation
(old dead/new works), revocation (next-call denial), and transaction
identity isolation (sequential user switching, no leakage). It needs
local `initdb`/`pg_ctl`/`psql` binaries and skips with a warning when
they are absent:

```sh
pnpm vitest run tools/connector-harness/server.test.ts
```

## Notes and limits

- Issuance impersonates the configured test owner for the issuance
  transaction only; grant ownership is still bound to that owner by the
  database RPC, and staff issuance rules are unchanged.
- Audit output is JSON lines on stdout (grant id, route, status, latency;
  never tokens). A durable audit sink is R1 work.
- The harness proves local connectivity, discovery shape, issuance,
  rotation, revocation, bounded reads, and denials. Platform-driven token
  refresh, Muse tool discovery behavior, and scheduled checks can only be
  proven in the pilot environment (see the pilot runbook).

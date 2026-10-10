# R1 Read-Only Connector — Staging Proof (3 October 2026)

Authorized: R1 implementation + isolated staging validation, with C-prime
accepted for read-only R1 under ADR-003 (owner decision, 3 Oct 2026).
Production infrastructure changes, production database access, deployment,
purchases, and commits remain separately authorized — none performed here.

Branch `baci-connector-r0-proof` (`tzguvkfjycnrzeigigvs`), resumed for
validation and re-paused after teardown. Production parent untouched.

## 1. What was built

- Deployable REST/OpenAPI gateway (`apps/web/tools/connector-gateway/`):
  required stable `CONNECTOR_GATEWAY_PUBLIC_BASE_URL` (HTTPS, loopback
  HTTP only), scoped issuance/rotation/revocation, per-key + per-IP rate
  limits (env-configurable), stable `{ error, code }` taxonomy with
  `retry-after`, durable audit sink. Refuses `NODE_ENV=production`
  without the explicit production approval flag.
- Owners-only Connect/Disconnect: `src/app/api/integrations/muse/route.ts`
  (server-side owner check on every method, metadata columns only) +
  `src/app/dashboard/integrations/muse/` page, linked from the
  integrations hub with an honest owners-only label. Multi-connection:
  GET lists every active grant, POST creates one grant per call (one
  credential per agent) with an optional stable `connectionId` for
  retry-safe reconnects, DELETE revokes a single connection by id.
- Four working runtimes sharing the R0 C-prime flow (resolve RPC, then
  one transaction under `SET LOCAL ROLE authenticated` + jwt claims):
  `orders.list`, `orders.get`, `inventory.levels`, `analytics.summary`.
  Manifest `r0.3` (adds optional inventory `limit`). Payment and shipping
  stay separate fields. No mutations anywhere.
- Migrations: `20261003090000` audit table (INSERT-only for
  `connector_gateway`, member SELECT via grant linkage) and
  `20261003120000` inventory member-read policy (see §2).

## 2. Issues found on the real schema and fixed

- **variant_inventory denied every member read.** RLS enabled, zero
  policies, grants to postgres/service_role only — the R0-equivalent
  miss for R1: fixture tests passed while production-shaped reads
  returned zero rows. Fixed with the `20261003120000` migration:
  merchant-scoped member SELECT policy (`has_merchant_access`) plus a
  column-scoped grant (`id, variant_id, merchant_id, branch_id,
  status` only — IMEI/serial identifiers, notes, and provenance stay
  hidden). Validated red→green: pre-migration owner counts would read 0;
  post-migration owner sees seeded units, stranger sees 0 (SQL test).
  Production application of this policy is a production-scope decision.
- **Discovery advertised owner endpoints.** The gateway OpenAPI listed
  `/v0/issue-token`, `/v0/refresh`, `/v0/revoke` (unreachable, 404 at
  the proxy) — Muse would surface them as broken tools. Fixed:
  discovery serves exactly the four `/v0/tools/*` paths; unit test
  asserts the closed path set.

## 3. Staging evidence (branch, full schema)

- Migrations applied cleanly; SQL suites pass: R0 grants, R1 audit, R1
  inventory member-read (all `ON_ERROR_STOP`, all rollback-clean).
- Public transport (Caddy allowlist + HTTPS tunnel): `/openapi.json`
  200 with correct `servers` + 4 paths; tools 401 without auth;
  issue/refresh/revoke/health/unknown all 404.
- Throwaway merchant-wide grant (`orders:read inventory:read
  analytics:read`): `orders.list` 200 (3 merchant-A orders);
  `orders.get` 200; `inventory.levels` 200 with exact predicted counts
  (A1: 3/1/0, A2: 1/0/1 + low-stock flag), merchant-B rows absent;
  branch narrowing returns only A2; `analytics.summary` 200 with exact
  predicted aggregates (3 orders, 2 paid, 400 revenue, pending 2 /
  shipped 1, stock 4/1/0). Foreign merchant selector → 403, bad token
  → 401.
- Rotation: 200, old token 401, replacement 200. Revocation: next call
  401. Rate limit (limit 5): 5×200 then 429 + `retry-after`.
  (An initial 130-request flood stayed 200 because pooler latency
  spread it over 149s across 60s windows — test artifact, not a code
  defect; the limiter trips 10/130 in direct probe.)
- Audit: every call recorded (route/status/latency + grant id, no
  credential or payload columns by schema); owner reads 148 linked
  rows, stranger reads 0.
- Teardown: all test grants revoked (0 active), `connector_gateway`
  back to `NOLOGIN`, processes stopped, /tmp secrets deleted, branch
  re-paused.

### 3d. Addendum: reissue recovery preflight (final tree)

Resumed the branch, applied the `20261003130000` reissue migration,
and ran the full transport preflight on the final tree: `/openapi.json`
200 with exactly 4 tool paths, tools 401 unauthenticated,
issue/refresh/revoke/health/unknown 404 through Caddy, throwaway grant
issued locally, all four tools 200 through the public tunnel (3 orders,
inventory levels, analytics summary), bad-token 401 with a safe
`GRANT_REVOKED` body, revoke 200 with the next call denied, and 13
audit rows covering every call. Both SQL regressions pass on the
branch (reissue + grants R0). Teardown: 0 active grants, gateway
NOLOGIN, processes stopped, run secrets deleted. Branch left ACTIVE
for the imminent operator pilot (re-pause afterwards).

### 3c. Addendum: multi-grant coexistence (per-agent connections)

The Connect flow no longer stops at one usable grant per merchant: GET
lists every active connection, POST creates one grant per call (one
credential per agent) with an optional stable `connectionId` for
retry-safe reconnects, and DELETE revokes a single connection by id.
A retry with an existing `connectionId` reissues fresh credentials in
place via the owner-only `reissue_connector_grant_tokens` RPC (old pair
dies, scopes/branches unchanged), so a lost first response never
strands the connection; a match that changed concurrently returns 409
`VERSION_CONFLICT` with an explicit re-list recovery.
Proven on the branch: two active grants for merchant A coexisted, each
resolved independently under its own scope, the cross-scope resolve
failed closed (`connector_scope_denied`), and both revoked cleanly
(0 active afterwards). Branch re-paused; no standing credentials.

### 3b. Addendum: inventory-test fix re-verification

The CodeRabbit-flagged order-dependence was fixed (counts scoped to
the test variant) and re-proven on the populated branch: the old
merchant-only filter counts 6 seed units (red — the old assertion
would fail), while the fixed test passes (green). Branch re-paused
afterwards; no standing credentials remain.

## 4. Local checks

- Vitest connector scope: 22 files / 152 tests pass (12 harness
  runtime + 11 gateway runtime incl. HTTP/proof coverage and outage
  mapping, 23 Connect route tests incl. reissue recovery, conflicts,
  and revoke-closed expiry, 7 Connect page tests incl.
  credentials-before-status and per-grant credential clearing,
  rate-limit/config/audit unit tests).
- Biome clean on all touched files (44 files).
- `pnpm typecheck`: 21 errors, all pre-existing in google-ads routes
  (identical set on the untouched base); 0 connector/R1 errors.

## 5. Exact Muse Desktop test prompt (finished connector)

```text
Build a private custom connector named Baci R1 Staging from this REST API:
<STAGING_BASE_URL>/openapi.json

For authentication, select HTTP Bearer authentication. I'll enter the
token in Muse's secure credential prompt; store it outside chat,
generated code, and logs, and never ask me to paste it into
conversation text.

Call orders.list with {"limit":5}, then orders.get for one returned order.
Show the actual outcomes and synthetic order IDs. Keep payment and shipping
statuses separate. Then call inventory.levels with {"limit":10} and
analytics.summary with {}; report counts only, no identifiers beyond the
returned IDs. Save the working integration for reuse after it succeeds.
```

Prerequisites (the branch is paused and no staging URL persists between
sessions): the operator resumes `baci-connector-r0-proof`, runs the
gateway staging preflight in `apps/web/tools/connector-gateway/README.md`
(Caddy allowlist + HTTPS tunnel + throwaway checks), and issues one
pilot grant locally per agent under test. Replace the URL with that
run's preflighted staging URL, enter the operator-issued access token
only at Muse's secure credential prompt, and expect merchant-A
synthetic data only. Multi-agent pilot: connect each agent as its own
row in Dashboard → Integrations → Muse, one credential per agent.

## 6. CodeRabbit review (3 October 2026)

Completed with 8 findings surfaced (7 in the captured pass, plus the
disconnect-copy minor fixed just before it); 7 fixed and verified,
1 skipped with reason:

- **Connect-page status bug (major, fixed):** the connect flow read
  `data.connected`, which POST never returns — the UI showed the
  connect form after a successful connect. Fixed at the time by
  deriving from `data.grant.usable`; later superseded by the
  multi-connection rewrite (GET now returns a connections list).
- **Rate-limiter key allocation (major, fixed):** IP-denied requests
  allocated key counters first. IP budget is now checked first with
  early return; regression test added.
- **429 audit amplification (major, fixed):** every rejection awaited
  a DB INSERT. Rejections are now sampled (first per client per
  window); runtime test asserts the sampling.
- **Proxy client attribution (major, fixed):** every public client
  shared the `127.0.0.1` IP budget behind Caddy. Added
  `CONNECTOR_GATEWAY_TRUSTED_PROXIES` (default loopback) with
  X-Forwarded-For honored only from trusted peers; unit-tested.
- **Inventory test order-dependence (major, fixed):** owner/stranger
  counts filtered by merchant only, so pre-existing units broke the
  assertions. Now scoped to the test variant; re-verified on the
  populated branch (see §3 addendum below).
- **Stale README 501 claims (minor, fixed):** inventory/analytics
  rows now describe the real runtimes.
- **Disconnect copy (minor, fixed in prior pass):** unusable-grant
  branch no longer promises a missing disconnect control.
- **useCallback wrappers (trivial, skipped):** current memoization is
  a correct exhaustive-deps pattern, not a defect.

### 6b. Addendum: second pass (5 findings)

- **Grant-read failure handling (major, fixed):**
  `readActiveConnection` returned null on query/validation errors, so
  GET misreported outages as "disconnected" and POST issued grants
  over them. Reads are now discriminated; failures return a safe 500
  (`UNKNOWN_OUTCOME`, no internals) and POST creates nothing. Three
  regression tests added.
- **429 sampling bypass (major, fixed):** sampling by `ip|keyId` let
  attacker-chosen credentials mint distinct entries for IP-budget
  rejections. The limiter now reports which budget denied
  (`limitedBy`), and IP denials sample by IP alone. Unit test added.
- **400 code inconsistency (minor, fixed):** issuance-validation
  raises now return `INVALID_REQUEST` (matching the Connect path)
  instead of `FORBIDDEN_SCOPE`; test asserts the code.
- **Partial unique index (major, skipped):** one-active-grant-per-
  merchant would forbid legitimate coexistence (branch-scoped +
  merchant-wide grants, other agents' connections) and turn
  gateway-issued grants into connect-flow conflicts. The race only
  creates an extra scoped grant — no privilege gain — and the
  connect comment now states best-effort semantics honestly.
- **useCallback wrappers (trivial, skipped again):** same correct
  pattern as the first pass; no defect.

### 6c. Addendum: third pass (1 finding, fixed)

- **Credentials set after status refresh (minor, fixed):** the Connect
  handler awaited `loadStatus()` before storing the one-time pair, so
  a status failure discarded fresh credentials and misreported success
  as failure. Credentials are now stored first, `loadStatus` catches
  fetch/JSON failures into `statusError` (also fixing the mount-path
  unhandled rejection), and the retry toast reads "Reissued fresh
  credentials". Regression test added.

### 6d. Addendum: fourth pass (3 findings, fixed)

- **Create reread failure strands credentials (minor, fixed):** a
  failed post-create metadata reread returned 500 without the pair.
  The route now builds the grant view from the request inputs (fresh
  rows are active at version 1 — exact, not guessed) and still
  returns 201 with the tokens. Regression test added.
- **Cross-merchant id collision returns 500 (minor, fixed):** a
  duplicate-key with no usable match in the merchant now returns 409
  `VERSION_CONFLICT` directing the caller to a new id. The
  merchant-namespacing half was skipped: client-supplied stable ids
  are the retry feature, and the 409 resolves the confusion without
  a contract change. Regression test added.
- **Refresh/revoke DB errors fall through to 400 (minor, fixed):**
  both handlers now wrap grant calls in `pgErrorToHttp` + audit like
  issue-token and the tools, so outages return 500
  `UNKNOWN_OUTCOME`. Runtime test against a dead database added.

### 6e. Addendum: fifth pass (1 finding, fixed)

- **Disconnect clears all credentials (minor, fixed):** `handleDisconnect`
  unconditionally cleared the one-time pair, so disconnecting one
  connection wiped another's credentials from the screen. The pair is
  now associated with its producing grant and cleared only when that
  grant disconnects. Regression test added.

### 6f. Addendum: sixth pass (2 findings, fixed)

- **Expired-but-active grants skip revoke (minor, fixed):** the DELETE
  `usable` guard short-circuited expired rows with `revoked: false`,
  leaving them `active` forever. Only non-active rows skip the RPC
  now; expired actives are revoked for real. Regression test added.
- **Retry lookup capped at 50 rows (minor, fixed):** both retry paths
  searched the capped list read, so a merchant past the cap could
  miss its grant and mint a duplicate. Retries now query directly
  by `(merchant_id, connection_id)` via `maybeSingle`, keeping the
  usable-grant checks and response behavior. Regression test added.

### 6g. Addendum: seventh pass (clean)

Confirmatory review of the complete staged diff completed with
0 findings. The review gate is satisfied on this exact tree.

## 7. Remaining blockers

- **Operator-reported Muse Desktop R1 pilot (3 October):** `orders.list`
  returned 200 with three synthetic orders; `orders.get` returned 200;
  `inventory.levels` returned 200 with two stock levels; and
  `analytics.summary` returned 200 with three orders, revenue 400, and stock
  counts. The operator reports no store writes. These results complete the
  four-operation staging smoke test; they do not independently prove
  production behavior.
- Muse-specific observations still open: native scheduled execution, automatic
  refresh behavior, cross-device credential reuse, and operation-specific
  approval receipts. Earlier scheduling evidence from an agent-run workflow
  does not prove Muse Desktop's native scheduling behavior.
- Production-scope ADR-003 decision (covers gateway deployment AND the
  `variant_inventory` member-read policy production application).
- No commit made; seven CodeRabbit passes consumed (final pass clean)
  — uncommitted pending ship authorization.

The operator subsequently reported cleanup complete: the pilot grant revoked
(zero active grants), gateway role returned to `NOLOGIN`, gateway/Caddy/tunnel
stopped, `/tmp/baci-pilot` deleted, and the branch paused. No production
infrastructure or parent database was changed.

### Stable-ID request consistency follow-up (2026-10-04)

Both stable-ID retry paths now require the original request fingerprint and
unchanged live permissions before reissuing credentials. Changed scopes,
branches, merchant-wide access, requested lifetime, stored expiry, or a legacy
row without a fingerprint returns `409 IDEMPOTENCY_KEY_REUSED`. Matching retries
preserve the original absolute expiry. Permission arrays are compared as sets;
timestamp offsets are normalized. The fingerprint is metadata, never a token,
and is not included in the public connection view.

The append-only `20261004181000_connector_request_fingerprint.sql` migration
adds the fingerprint column and an owner-checked atomic creation wrapper.
Local database regression coverage verifies persistence, invalid-input rollback,
foreign-merchant denial, and anonymous execution denial. It has not been applied
to production. Deploy this migration before the updated management route.

The selected connector suite passed 165 tests in 22 files after this change.
The public gateway and privacy deployment remain separate release gates; these
local results do not establish production availability or submission acceptance.

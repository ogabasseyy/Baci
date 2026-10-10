# Funding readiness connection and packaged factory smoke

Status: **READY FOR PARENT REVIEW** — local synthetic verification only.

## Implemented interface

`createPiggyvestCustomerFundingScreen(options)` takes the existing
`createPiggyvestCustomerScreenRuntime` options plus:

- `fundingConfiguration`: explicit existing deployment-gated funding-view config;
- `fundingExecute`: standard restricted policy executor for the new atomic read;
- `mappingExecute`: separately restricted existing mapping reader;
- `fetchImplementation`: explicit server-side read transport (synthetic in tests).

It returns `GET`, `POST` (unchanged policy handlers) and `readScreen(request)`.
No funding HTTP route is installed. Parent/Fermat can compose `readScreen` into
their authenticated server projection without changing the shared DTO. Only
funding eligibility is established: `progress` always remains `unavailable`.
No provider balance becomes purchasing power, and no ledger writes, activation,
scheduled collection or financial provider dispatch are introduced.

The actual screen runtime verifies authenticated RLS ownership and SHA256-bound
stored terms before the new resolver runs. The concrete resolver repeats the
existing RLS context, validates matching staging/project/business/customer config,
then invokes `read_funding_capability`, not an injected allowed boolean.

The RPC uses existing registry/ledger/policy/customer/goal locks. It requires the
current linked actor, accepted exact policy and explicit matching duration;
paused/manual goal with zero legacy amounts, no legacy contributions/terminal
timestamps, cancellation intent, active purchase/refund reservation, reversal or
settlement history. Zero internal principal and internally funded drafts remain
eligible: activation is deliberately not a prerequisite to first funding.

Mapping must be the existing unique immutable goal mapping and match current
tenant scope. Completed plan verification must match its exact wallet/customer,
business and fingerprint. Completed new-customer provenance must independently
match; a manually inserted mapping alone does not establish readiness.
The existing mapping INSERT trigger takes a conflicting goal SHARE lock;
provisioning confirmation takes registry UPDATE. Both serialize against the
capability read. No new table grants or default-enabled configuration are added.

After the atomic read commits, the existing funding-view/adapter verifies the
mapped provider wallet/business/currency/active state and retrieves accounts
through the existing canonical fixed staging transport. Only account number,
account name and bank name are projected. Empty accounts mean pending eligibility,
not allowed. Missing/unverified capability remains unavailable.

Before publication, the binder repeats the concrete capability read and compares
actor, goal, mapping, revision, duration, accepted receipt, terms and device
against the original verified projection. Request abortion suppresses account
publication. No database lock is held across HTTP. This is a snapshot, not a
lease: later goal changes or external deposits cannot be prevented by a prior
display. Future routing must retain no-store/session invalidation and revalidate
any action independently. Account display does not authorize a future payment.

## SQL and parent ownership

Frozen new migration:
`supabase/migrations/20260912170000_customer_funding_capability.sql`

SHA256: `1146d13f3a8187007b9a542f5d9ca3b9256353f18b3886e003795782a5fa4062`.

`CUSTOMER_FUNDING_CAPABILITY_STATEMENTS.readFundingCapability` is exactly:

```sql
SELECT piggyvest_goal_policy.read_funding_capability($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid) AS result
```

Arguments: integration, merchant, customer, goal, business, authenticated actor.
Only the existing policy-writer role is catalogued by the parent. SQL itself
requires that login, a Unix-socket local connection and `piggyvest_local` database.
Existing ledger and policy bindings must both match that login; the RPC does not
grant direct ledger access. Parent owns catalog/global hash registration and
independent review. No existing migration was edited.

## RED/GREEN and verification

- New screen suite first failed for the missing binder; SQL harness first reached
  the missing new RPC after constructing real policy/provisioning fixtures.
- Exact pending-account regression failed with eligibility incorrectly allowed;
  now pending. Exact aborted-request regression failed with account publication;
  now suppressed. Post-provider revision/wallet/actor/duration/hash drift rejects.
- Exact settled-purchase SQL regression failed because a paused public goal with
  consumed reservation looked fundable; final 1700 rejects settlement history.
- SQL harness covers zero-principal first funding, internally funded drafts,
  mixed legacy state, actor/terms changes, missing duration/provenance/completion,
  altered mapping, purchase/refund reservations and reversal. Fault injection is
  confined to rollback-only synthetic transactions; immutable production tables
  are not modified. Cases pass before and after database restart.
- An observed two-session lock wait proves a funding read waits for a concurrent
  legacy amount update and then rejects the committed mixed state.
- Real standard executor → atomic RPC → mapping reader → existing funding
  adapter → screen DTO passes with disposable PostgreSQL and injected synthetic
  provider HTTP. The test role has no direct table/helper access. Auth/RLS client
  behavior is synthetic, not a Supabase login; provider readiness is simulated.

Commands from the implementation root:

```sh
pnpm --dir apps/web exec vitest run src/lib/piggyvest/customer-funding-screen.test.ts src/lib/piggyvest/customer-funding-capability.test.ts src/lib/piggyvest/customer-funding-capability-statements.test.ts src/schemas/customer-funding-capability.test.ts src/lib/piggyvest/customer-funding-view.test.ts src/lib/piggyvest/customer-screen-runtime.test.ts src/lib/piggyvest/funding-accounts.test.ts
bash tools/test/customer-funding-capability-local.test.sh
pnpm exec node --test tools/test/piggyvest-package-smoke.test.mjs
pnpm exec biome check apps/web/src/lib/piggyvest/customer-funding-screen*.ts apps/web/src/lib/piggyvest/customer-funding-capability*.ts apps/web/src/schemas/customer-funding-capability*.ts tools/test/piggyvest-package-smoke*.mjs
```

Final focused results: 93 Vitest tests across seven suites, one real-executor
PostgreSQL integration test, and one Node packaging smoke test passed. SQL cases
passed before/after restart and the observed concurrent lock-wait check passed.
Biome passed for 12 scoped files; the final smoke-only rerun passed its Node test
and both packaging files' Biome checks.

Scoped TypeScript API diagnostics for the ten owned funding TS files: zero after
the final abort regression; parent retains full-project typecheck ownership.
No root checks or deployment are claimed by this task.

## Packaging smoke: TEST substitutions, not deployment recipe

`tools/test/piggyvest-package-smoke.mjs` bundles Fermat's actual
`runtime-composition-server.ts` and the funding binder as separate Node CJS
entries. It creates no replacement router/server. Explicit aliases resolve the
existing shared contracts; only built-in Node externals are accepted. Secret/env
file inputs are rejected, and the build does not discover an env file or install
dependencies. Output is held in memory, then tested in an owned disposable
directory removed after server closure.

**`process.env = {}` substitution and the server-only marker shim are TEST-ONLY.**
They are not production secret wiring or permission to load server code in a
browser. Missing configuration still fails closed. Real RLS clients and restricted
executors remain injected dependencies; this is not a standalone deployed system.

Smoke executes the actual bundled loopback HTTP server, verifies policy/cancel/
recovery unauthenticated denial, no-store, fixed methods/routes, wrong-origin and
actual CSRF checks, malformed body rejection and no SQL work on denied requests.
The bundled funding factory is callable with no ambient/provider network; absent
auth exposes no account. `/funding` remains 404. A repeated build compares artifact
digests. Metadata and digest equality prove this local dependency boundary and
repeatability only, not runtime certification or production portability.

Final local checkpoint: 265 metafile inputs; repeated-build digests matched.

| TEST artifact | Bytes | SHA256 |
| --- | ---: | --- |
| `http.cjs` | 981000 | `3431fd1ebd56f0fc4baa1f6689b984ea7ebc49f82732ad2bea61bb05bf811d77` |
| `funding.cjs` | 698953 | `3356b8e78497a375c5033baa8c48d0c5f07c3d3834cd779a26ebc2e26c949f9f` |

These hashes describe this shared-worktree checkpoint, not a signed release or
immutable production build. Generated files are deleted by owned cleanup.

Fermat's existing real-PostgreSQL HTTP harness remains separate and was not
duplicated. The funding binder has its own real-executor database composition
test above; successful funding over a newly installed HTTP route is not claimed.

## New files owned in this batch

- `apps/web/src/lib/piggyvest/customer-funding-screen.ts`
- `apps/web/src/lib/piggyvest/customer-funding-screen.test.ts`
- `apps/web/src/lib/piggyvest/customer-funding-screen.test-fixture.ts`
- `apps/web/src/lib/piggyvest/customer-funding-screen.runtime.test.ts`
- `apps/web/src/lib/piggyvest/customer-funding-screen.report.md`
- `apps/web/src/lib/piggyvest/customer-funding-capability.ts`
- `apps/web/src/lib/piggyvest/customer-funding-capability.test.ts`
- `apps/web/src/lib/piggyvest/customer-funding-capability-statements.ts`
- `apps/web/src/lib/piggyvest/customer-funding-capability-statements.test.ts`
- `apps/web/src/schemas/customer-funding-capability.ts`
- `apps/web/src/schemas/customer-funding-capability.test.ts`
- `supabase/migrations/20260912170000_customer_funding_capability.sql`
- `tools/test/customer-funding-capability-local.test.sh`
- `tools/test/customer-funding-capability-fixture.sql`
- `tools/test/customer-funding-capability-cases.sql`
- `tools/test/customer-funding-capability-runtime.sql`
- `tools/test/piggyvest-package-smoke.mjs`
- `tools/test/piggyvest-package-smoke.test.mjs`

## Remaining boundaries

Parent owns actual customer-route composition and reviews the statement/hash.
TLS funding-capability execution is intentionally disabled. External staging
approval, verified real account/provisioning capability and signed financial
attribution are not supplied by fixtures. Provider financial posting, paid-interest
eligibility, purchase/refund settlement and fees remain separately gated as
documented in `docs/piggyvest-provider-final-readiness.md`. They do not prevent
this local first-funding connection. No provider credentials, real accounts,
customer funds, remote database, deployment or external messages were used.

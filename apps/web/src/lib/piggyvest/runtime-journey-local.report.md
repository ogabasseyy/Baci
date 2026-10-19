# Connected local funding HTTP and synthetic journey

**READY FOR PARENT REVIEW**

Local synthetic evidence only. Not provider sandbox, customer money, real login,
production packaging, deployment, or full-product acceptance.

## Runnable commands

From `/Users/mac/Baci-worktrees/cursor-savings-phase1`:

```sh
bash tools/test/runtime-journey-local.test.sh
bash tools/test/runtime-journey-local.test.sh browser-check
bash tools/test/runtime-journey-local.test.sh browser
bash tools/test/runtime-journey-local.test.sh browser-verify
pnpm --dir apps/web exec vitest run src/lib/piggyvest/customer-funding-http.test.ts src/lib/piggyvest/runtime-journey-local-fixture.test.ts
pnpm exec node --test tools/test/piggyvest-package-smoke.test.mjs
pnpm exec biome check apps/web/src/lib/piggyvest/customer-funding-http*.ts apps/web/src/lib/piggyvest/runtime-journey-local*.ts tools/test/piggyvest-package-smoke*.mjs
```

Requirements: existing pnpm dependencies and local PostgreSQL 18 at
`/opt/homebrew/opt/postgresql@18/bin`. No dependency installation occurs.
The HTTP journey takes approximately one minute because expiry uses PostgreSQL's
actual clock, not a mocked timestamp. Each command creates its own disposable
Unix-socket-only `piggyvest_local` cluster. Registered migrations are copied and
hash-verified by the existing staging replay planner; no migration is edited.
Cleanup stops only that cluster and removes only its owned directories. A failed
stop preserves the cluster directory rather than deleting running database data.

`browser-check` invokes Sartre's actual UI bundle/proxy and verifies connected
HTTP behavior, then closes it. `browser` holds the same composition on explicitly
pinned `http://127.0.0.1:4181` for browser QA until SIGINT/SIGTERM. It must not run
while another owner holds that port. The bridge does not install a replacement
business router. It does not re-seed or reset another running session.

Follow-up: `browser-verify` creates a separate fresh cluster and current browser
bundle on explicitly pinned port 4183, leaving the held 4181 cluster and its
consumed goal-702 evidence untouched. Sartre owns launching and checking this new
fixture; no concurrent full HTTP journey is required. The added pinned-port
configuration has seven passing focused tests and scoped Biome validation.

## Funding connection

`createPiggyvestCustomerFundingHttp(options)` accepts exactly the existing
`createPiggyvestCustomerFundingScreen` options and returns `GET(NextRequest)`.
It requires `/funding` with exactly one `goalId` query value matching the configured
server goal. It authenticates before query/configuration/protected reads, uses
the concrete authenticated RLS context before and after the existing binder, and
compares exact actor and scope. The binder itself retains its two exact atomic
funding-capability/provenance reads around mapped-wallet/account verification.

Success is the existing strict public screen DTO. `funding` is ready/pending/
unavailable; `progress` remains unavailable. Errors are generic and all responses
are no-store/nosniff. No client wallet/customer/merchant/account selection or
provider balance is promoted to financial authority. Fermat owns the sole actual
router and its request-abort service wrappers; this task did not edit those files.

## Connected journey

- Actual packaged `runtime-composition-server.ts` listener/router and actual
  packaged `postgres-executor.ts` with JavaScript node-pg, restricted login and
  exact statement catalog. There is no mock SQL executor in this journey.
- Synthetic request-scoped RLS responses and the explicit
  `synthetic-session=owner` fixture cookie, never a real Supabase session. Other
  actor and missing-session denials are exercised. Real session-bound `/csrf`
  bootstrap supplies token/cookie; no hardcoded CSRF bypass is used.
- Goal 701: exact variant 701 / 256GB. Goal 702: exact variant 702 / 512GB.
  Both start as unaccepted, zero-principal, paused/manual drafts. Goal 703 tests
  quote expiry; goal 704 tests cancellation of an in-flight HTTP read.
- Snapshots and known synthetic plan-wallet provenance are staged using actual
  policy/provisioning APIs. Original completed synthetic customer provenance is
  reused, not invented from a mapping alone. Fixture-only responses cover only
  the canonical staging wallet GET and its accounts GET; any other target or
  method throws. No provider request is dispatched to the network.
- Duration preparation then actual POST consent precede account display and
  fixture credit. Zero principal still permits verified funding display; consent
  alone does not grant eligibility. Provider balance is deliberately unrelated
  and progress remains unavailable.
- Explicit local SQL fixture credits exactly 5000 internal kobo after consent.
  Replaying the same synthetic operation/evidence identity twice does not double
  credit. This is **not webhook processing or provider attribution**. Temporary
  fixture privileges are granted/revoked within its transaction, never exposed
  through HTTP; SQL postconditions verify no privilege escaped.
- Goal 701 activation and replay preserve the same local-synthetic receipt and
  no collection consent. Goal 702 cancellation quote/preparation/replay/recovery
  retain all 5000 principal with `dispatch: contract_gap`; no actual refund or
  interest disposition occurs. This is the separate-cancellation-goal branch of
  the requested journey, not purchase execution coverage.
- Actual schedule pause and explicit resume proposal persist with
  `debitPermission: false`. PostgreSQL-clock quote expiry followed by observation
  persists paused/null-consent. No scheduled collection is dispatched.
- The listener-shutdown regression releases a deliberately late synthetic wallet
  read and confirms the later accounts read is not dispatched. The already-started
  wallet read is not claimed undone; disconnected response and prevention of
  subsequent provider work are separate assertions.
- PostgreSQL and listeners restart; activation replay, retained cancellation
  recovery, and expired schedule state persist. SQL assertions count exactly two
  synthetic credit operations and verify no direct ledger/table grants escaped.

## Verification and failures retained

- Funding HTTP TDD: new suite initially failed on the missing adapter; 10 tests
  pass, including malformed/duplicate selection, cross-goal denial, configuration
  gating, no metadata leakage and post-provider actor drift.
- Connected RED: the actual old packaged router returned 404 for `/funding`
  where authenticated routing was required; the new owner-composed route passes.
- The strict package initially rejected unexpected `pg-native`. After explicit
  approval, an exact throwing TEST shim and native-probe regression were added;
  native access fails closed and real bundled JavaScript node-pg still executes
  the actual restricted PostgreSQL journey.
- Intermediate fixture-order/import/mock-environment errors were corrected in
  owned tests, not bypassed in runtime. One repeated-digest test observed a
  concurrently changing HTTP artifact and correctly failed; a subsequent stable
  rerun passed without weakening digest equality.
- Focused unit suites: 12 tests passed. Packaging Node smoke: one test passed.
  Browser-check: one actual connected test passed in an independently disposable
  cluster. Final HTTP/PG command: four tests passed (one abort, two connected
  journeys, one restart), plus SQL duplicate-credit/ACL assertions before and
  after restart. Biome: 11 scoped files passed. Owned scoped TypeScript
  diagnostics: zero. Parent retains root-check ownership.

## TEST packaging boundary

`process.env={}`, the `server-only` marker shim and exact throwing `pg-native`
shim are explicitly **TEST substitutions**, not production deployment guidance.
No native fallback is installed or allowed as an external. Metadata rejects all
non-Node-builtin externals and env/secret input files. The native probe is a
synthetic diagnostic entry, not an application endpoint. Missing configuration
fails startup and missing funding service stays 503; empty env enables no gate.

Artifacts are `http.cjs`, `funding.cjs`, `executor.cjs` and `nativeProbe.cjs`.
They are generated in memory, loaded only from owned temporary directories, then
deleted. Digests and dependency metadata prove only repeatability/dependency
boundaries at a particular dirty-worktree checkpoint, not runtime certification.

Checkpoint metadata: 389 inputs; only Node builtin externals.

| Artifact | SHA256 |
| --- | --- |
| http.cjs | af278106b8419f21b3c806ced1c8d659c87d86afd91eda43150836cf4af45bc0 |
| funding.cjs | 3356b8e78497a375c5033baa8c48d0c5f07c3d3834cd779a26ebc2e26c949f9f |
| executor.cjs | a0b8ed7b778196494332bd5a2a41cf3a62ec483956f1c6d1a1faff9b86d1ebc1 |
| nativeProbe.cjs | 9a1ff6d9cc9613f16bddc280d5488c2f1cf7df1c54d56a7b61cdb8b65ba00832 |

Concurrent changes can invalidate these digests. Frozen funding SQL 170000 remains
`1146d13f3a8187007b9a542f5d9ca3b9256353f18b3886e003795782a5fa4062`.

## Owned files

New in `apps/web/src/lib/piggyvest/`:

- `customer-funding-http.ts`, `customer-funding-http.test.ts`
- `runtime-journey-local.ts`, `runtime-journey-local.test.ts`
- `runtime-journey-local-fixture.ts`, `runtime-journey-local-fixture.test.ts`
- `runtime-journey-local-abort.test.ts`, `runtime-journey-local-restart.test.ts`
- `runtime-journey-local-browser.test.ts`, `runtime-journey-local.report.md`

New in `tools/test/`:

- `runtime-journey-local.test.sh`, `runtime-journey-local-fixture.sql`
- `runtime-journey-local-credit.sql`, `runtime-journey-local-expire.sql`
- `runtime-journey-local-assert.sql`

Explicitly approved edits: `tools/test/piggyvest-package-smoke.mjs` and
`tools/test/piggyvest-package-smoke.test.mjs`.

## Remaining boundaries

### Cleanup-status follow-up

The parent's first final run (`/private/tmp/piggy-parent-final-journey.log`)
passed four HTTP/PG tests and both SQL assertions, but ended with
`browser_port: unbound variable` while reporting exit 0. That is not clean
acceptance evidence. The script was concurrently changed while Bash was running;
the final source confines `browser_port` initialization/use to the browser branch.
A read-offset effect is consistent with the observation, not independently
proven as the original error's cause.

The stable, source-frozen baseline rerun subsequently passed all four tests and
both SQL assertions with clean exit 0, as reported by the parent in
`/private/tmp/piggy-parent-final-journey-stable.log`. No runner/runtime changes
were made during that rerun.

An independent exact host-Bash regression did prove a separate exit-status bug:
a nounset error followed by successful EXIT cleanup can report exit 0; even the
trap's initial `$?` can be zero. The narrow fix uses an explicit body-completion
sentinel, preserves explicit failing body codes, and explicitly fails when
PostgreSQL stop or directory removal fails. Failed stop retains both owned
directories and reports their paths. It neither resets nor stops another cluster.

`pnpm exec node --test tools/test/runtime-journey-local-cleanup.test.mjs` first
failed the nounset case (0 instead of 1), then passed all four cases: nounset,
failed stop with retained directories, successful cleanup, and explicit exit 7.
The tests execute the actual extracted cleanup function with owned synthetic
directories and fake `pg_ctl`, never an existing database. Scoped Biome passes.

Post-fix frozen runner SHA256:
`14b8c9397786233babdaba68073d2057601c12b84e092c7b7c03999b35d79ab4`.
The separate full post-fix rerun completed with **exit 0**, four passing HTTP/PG
tests (abort 1, connected journey 2, restart 1), and both SQL assertion blocks
passing. No shell error appeared. The runner hash remained unchanged throughout.
Its observed PostgreSQL PID 97058 exited; its exact owned directories
`/tmp/baci-piggyvest-full.uvbrM1` and `/tmp/baci-piggyvest-runtime.3MOxc8` were both
verified absent afterward. The clean parent baseline is not relabelled as a
post-fix test. Added owned test: `tools/test/runtime-journey-local-cleanup.test.mjs`.

Both preserved browser PostgreSQL processes remained running after cleanup:
4181 fixture PID 85688 (`full.jw8q9V`, `runtime.1c7ZNV`) and 4183 fixture PID 95059
(`full.LtMmVh`, `runtime.afBam9`). Their postmaster files and socket directories
remain present. No stop, reset, or removal operation targeted either browser hold.

Read-only inventory after the anomalous run found only the deliberately held
4181 and 4183 fixture pairs, not an orphan parent-journey cluster. The original
run did not print its temporary directory, so this is an inventory observation,
not identification of that run's exact removed path. Both browser fixtures and
their consumed operation evidence were preserved. Sartre separately reports the
current 4183 bundle passed actual prepare, immediate funding removal, recovery,
and recovery-only reload; this task did not independently perform those clicks.

Sartre owns browser presentation and its separate page-QA report. A held browser
process caches its built assets: source fixes do not update that already-running
page, and its committed database must not be reset to simulate recovery. This
task does not claim that held UI's latest source is loaded.

The fixture is a skeletal public schema, not full Supabase compatibility. Real
authentication, provider sandbox identity/provisioning/account verification,
signed webhook attribution, refund/interest/fee contracts, purchase dispatch,
production runtime wiring and deployment remain outside this local evidence.
Missing money contracts do not prevent these independent local connections.
No credentials, remote database, provider mutations, real customer data or funds,
existing migration edits, root manifest edits, deployment or git operations occur.

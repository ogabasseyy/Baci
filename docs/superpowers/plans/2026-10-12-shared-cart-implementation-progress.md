# Shared server cart: implementation progress

Worktree: `/Users/mac/Baci-app/.worktrees/shared-server-cart`
Branch: `codex/shared-server-cart`
Baseline: `origin/main` `88c83cc672d7716cb55e05132d95dc14582a8d43`
  (12 October 2026; release checkout `ebfd7e6e7f` is 2 commits behind).
Plan SHA-256 at copy: `1fda75a15f3848ab03388c80ecc1e68351433e6cd47b7bac7bd6f0adbbaf98c2`
  (matches the Luna review integrity record; originals preserved).

Product requirements: guest checkout, safe continuity across merchants,
ChatGPT, web and mobile. No merge, deploy or live orders from this work.

## Task status

- [x] Task 1: baseline + shared contract (see evidence below)
- [x] Task 2: scoped guest access + canonical schema (see evidence below)
- [x] Task 3: atomic commands + authoritative pricing (see evidence below)
- [x] Task 4: legacy migration without duplicate writers (see evidence below)
- [x] Task 5: authorized cart HTTP endpoints (see evidence below)
- [x] Task 6: secure replay-safe handoff and merge (see evidence below)
- [x] Task 7: web cart with optimistic feedback and fetch recovery
  (see evidence below)
- [ ] Tasks 8–14 per dependency order
  (11A → 8 → 9 → 10 → 11B → 12 → 13 → 14)
  Continuation status: 9, 10 and 11B complete locally; 8 local with
  device/provider qualification pending; 12 ownership gates complete
  with delegation/readiness split open; 13–14 documents prepared with
  live qualification and release steps unexecuted. See the
  2026-10-14 continuation section at the end of this document.

## Task 1 evidence

Source references: `docs/architecture/shared-cart-contract.md` (paths,
limits, grants, route protection refreshed against baseline).

TDD:
- RED: `pnpm --filter @baci/shared exec vitest run
  src/cart/line-identity.test.ts src/cart/commands.test.ts` →
  2 files failed, 14 tests failed / 5 passed. Failures were behavioral
  assertion failures against naive stubs (product-only identity key,
  accept-all command validator), not syntax/runner errors.
- GREEN: implemented `line-identity.ts` (sorted-option JSON identity
  key, unknown values preserved) and `commands.ts` (structural
  validation with inherited 20-line / 10-per-line bounds).
  `vitest run src/cart` → 2 files, 19 tests passed.
- `pnpm --filter @baci/shared typecheck` → clean.
- Full `@baci/shared` suite + Biome check on changed paths → see phase
  commit message for results.

Decisions:
- Shared contracts are dependency-free TypeScript; Zod stays with
  adapters (plan's `packages/shared` vs `apps/web/src/schemas` split).
- Canonical bounds adopt the strictest enforced existing values
  (MCP 20 lines / 10 per line / 7-day TTL); the web 50-line validate
  slice stays a legacy transport bound.
- Amounts in minor units; adapters convert from existing float prices.

## Task 2 evidence

New modules: `apps/web/src/lib/cart/{cart-runtime-env,session-proof,
principal,scoped-client}.ts` with colocated tests; migrations
`20261012050000_commerce_cart_core.sql` (8 tables, RLS enabled, indexed
FKs) and `20261012050100_commerce_cart_roles.sql` (3 dedicated roles,
narrow grants, claim-checked RLS policies, `cleanup_commerce_carts()`);
`supabase/tests/commerce_cart_access.sql` (14 isolation sections);
`shared_cart`/`shared_cart_realtime` enrollment flags via
`merchantHasFeature` (disabled for all plans; explicit grant only) plus
required `FEATURE_MESSAGES` entries.

TDD:
- JS RED: 23 behavioral failures on naive stubs (accept-all verifier,
  unnamespaced cookie, broad-role minter).
- JS GREEN: 25/25 pass (`session-proof`, `principal`, `scoped-client`
  suites, incl. a wrong-secret forgery test added from review feedback);
  `merchant-has-feature` + 2 consumer suites pass.
- SQL RED: first assertion failed under the policy-less roles stub
  (`permission denied`, legit shopper denied).
- SQL GREEN: all 14 sections pass on disposable PostgreSQL 18.6 with
  real roles (`psql -X -v ON_ERROR_STOP=1 ... -f
  supabase/tests/commerce_cart_access.sql` → ROLLBACK, no residue).
- REST GREEN: 9/9 assertions over real HTTP against PostgREST v13.0.5
  with real HS256 JWTs (own-cart read, wrong-merchant empty, receiver/
  anon/broad-authenticated denied, expired JWT 401, bootstrap insert
  accepted with owner-verified row, cross-merchant insert denied).
  Harness kept under `/tmp/baci-cart-rest-proof/` (throwaway probe, not
  committed); durable collateral is the SQL test above.
- `pnpm --filter @baci/web typecheck` clean (incl. tools-workers, mcp);
  `@baci/shared` typecheck + 19 cart tests still green after the
  `VerifiedCartSession.grantId: string | null` bootstrap correction;
  Biome clean on all touched files.
- CodeRabbit (uncommitted): 2 minor findings, both fixed and re-proven —
  composite FK now `ON DELETE SET NULL (cart_id)` (SQL §15 pins the
  receipt survives with merchant intact); cleanup fn follows the MCP
  precedent (no vacuous definer caller check, explicit
  `REVOKE ... FROM PUBLIC, anon, authenticated`, owner postgres).
  SQL suite extended to 15 sections, still green.

Decisions:
- Proofs are HMAC-SHA256 `cp1` with env/aud binding, absolute TTLs
  (24h session capped at grant expiry, 15m bootstrap), rotation via
  previous secrets; DB grant liveness is rechecked per statement by RLS.
- Session grants allow add/set_quantity/remove/clear; `replace` stays
  reserved for platform adapters with preconditions (Tasks 3/12).
- No direct shopper writes except bootstrap cart/receipt creation; no
  grant minting outside the Task 3 creation RPC; receiver has zero table
  access until Task 8's topic policy.
- Proof replay within TTL is inherent to bearer proofs; mitigated by
  short TTLs, per-statement RLS rechecks and (Tasks 5–6) Secure/HttpOnly
  host-only cookies. JWT `exp` is enforced by PostgREST (proven 401).
- Existing customer/merchant sessions untouched: new modules make no
  auth calls, use a separate `baci-cart-<slug>` cookie namespace, and
  cart roles hold no grants on customers/orders (proven in SQL §13).

## Task 3 evidence

New modules: `apps/web/src/lib/cart/{service,repository,pricing,
mutation-errors}.ts` (injected client, no Next.js runtime imports) with
colocated tests; `apps/web/src/schemas/cart.ts` extended with strict
command/mutation/create Zod schemas (+5 tests); shared `CartInputLine`
and `add` commands accept optional voucher/negotiation attachments
(+2 shared tests); migration `20261012050200_commerce_cart_commands.sql`
(create/mutate/snapshot RPCs, offer helpers, `last_unit_price_minor`
column); `supabase/tests/commerce_cart_commands.sql` (20 sections) and
`supabase/tests/commerce_cart_concurrency.sql` (3 two-session
scenarios with a Python overlap runner under `/tmp/baci-cart-conc/`).

TDD:
- JS RED: 25 behavioral failures on canned stubs. JS GREEN: 27/27 new
  service-side tests (82/82 incl. neighbors), 10/10 schema tests, 21/21
  shared cart tests.
- SQL RED: §1 creation failed under RPC shells returning canned
  `temporarily_unavailable`.
- SQL GREEN: 20/20 command sections on disposable PG 18.6 (create,
  replay, key/body conflicts, stale versions, sequential no-lost-update,
  response-loss reconcile, foreign rejection, exact variant price,
  old-op replay with `currentVersion`, pruned-body conflict, outage
  removal/reduction vs increase, no-ops, rollback cleanliness, locked
  cart readable, voucher pinning/distinctness, negotiation
  invalidation, expired grant).
- Concurrency GREEN: replay (loser waited 5998ms, qty added once),
  conflict (loser waited 5952ms, `version_conflict`, version stayed 2),
  create (converged on one cart, loser replayed after 5946ms).
- `pnpm --filter @baci/web typecheck` clean (incl. tools-workers, mcp);
  `@baci/shared` typecheck clean; Biome clean.
- CodeRabbit unavailable for Task 3 (org quota exhausted, 3/3 reviews
  used, no seat assigned; retried after the wait window). All other
  gates green; flagging for the packet reviewer instead.

Decisions: see `docs/architecture/shared-cart-contract.md` §Task 3
(replay/currentVersion, tombstone conflicts, no-op receipts, offer and
outage rules, voucher/negotiation handling, verbatim options with
checkout-time value enforcement, stable `replace` IDs, 7-day receipt
retention, standalone-worker-safe TS boundary).

## Task 4 evidence

New: `apps/web/src/lib/cart/legacy-migration.ts` (hash, 1:1 mappers,
migrate call) + tests; migration
`20261012050300_commerce_cart_legacy_migration.sql` (hash/fence columns,
maintaining + fence triggers, migrate RPC, MCP fence lookup);
`supabase/tests/commerce_cart_legacy_migration.sql` (11 sections).
Modified: `mcp-guest-cart.ts` (+`expectedVersion`/`operationId` only),
`guest-cart-errors.ts` (+`GuestCartMigratedError`), `guest-cart-store.ts`
(proactive fence check + trigger mapping), fake supabase (migration
mirror), `ucp-cart-storage.ts` (record field, assert, error mapping).
Also fixed a Task 3 latent bug: temp tables now dropped when present so
repeated replace/migrate calls share one transaction (new §21 pins it).

TDD:
- SQL RED: §2 failed on the canned RPC shell after §1 hash checks
  passed. SQL GREEN: 11/11 sections (hash fixtures, exact migration,
  replay, second-token refresh without attach/duplicate, foreign
  principal denied, stale-version refresh + fresh retry, missing/invalid
  fail-closed, fence trigger blocks, UCP fencing + staleness, lookup).
- Race GREEN (throwaway `/tmp/baci-cart-race/`): two sessions, one
  cart `a9e670fb`, one ref, loser replayed.
- JS RED→GREEN: migration client 8/8 (incl. DB-matching sha256
  fixture), MCP schema 18/18, store 17 incl. 3 fencing, UCP 5/5,
  worker-boundary tripwire green.
- Bare-node proof: tsx imports all 5 worker modules with zero web
  runtime imports (7 functions verified callable).
- Web typecheck clean (incl. tools-workers, mcp); Biome clean.
- Neighbor suites green: store concurrency, fake, tool + failures,
  cart schema tests (82/82 across 8 files).
- CodeRabbit still unavailable (quota); flagged for packet review.

Sequencing note: UCP route wiring of the new guards lands in Task 10
(adapters); until then no migrated UCP rows can exist because nothing
calls migrate, and the trigger fences every writer regardless.

## Task 5 evidence

New: `apps/web/src/app/api/storefront/cart/{route,bootstrap/route,
commands/route}.ts` + colocated tests; `apps/web/src/lib/cart/
{request-context,response}.ts` + tests; `cart-runtime-env.test.ts`;
migration `20261012050400_commerce_cart_create_grant.sql`;
`supabase/tests/commerce_cart_create_grant.sql` (4 sections).
Modified: shared `CartResult` (+optional `grantId`), repository
(uuid-validated `grantId` parse), service passthrough, principal
(`readProof` dep), `schemas/cart.ts` (+`cartBootstrapRequestSchema`,
merchant-override rejection pinned), `cart-runtime-env`
(+`getCartProofEnvironment`, VITEST-aware client guard),
`rate-limit-routes.ts` (+20/min bootstrap bucket).

TDD (each RED recorded before GREEN):
- Repository 2 RED → impl → 7/7; service 1 RED → 12/12.
- SQL RED: §1 `create must return a uuid grantId` on 50200 alone.
  GREEN: 4/4 grant sections; full 21-section commands suite also green
  with 50400 applied (throwaway path-rewritten copy in /tmp).
- Principal `readProof` 1 RED → 10/10; schema 2 RED → 13/13.
- Response 11/11 (incl. 409-with-cart reconciliation extra);
  runtime-env 3/3; request-context 23/23 (trust matrix, alias
  follow-through, unpublished/RPC-failure gating, cookie/Bearer
  proof preference, scope rules, quota isolation).
- Routes with real CSRF/proofs/quota/merchant-resolution/service and
  only anon-RPC + alias + scoped-client seams mocked: bootstrap 9/9,
  cart 14/14, commands 8/8.
- Neighbors: cart lib + schema + routes + rate-limit 212/212 across
  23 files; shared cart 21/21. Web + shared typechecks clean;
  Biome clean.
- SQL regressions on disposable PG 18.6 (fresh initdb per
  unconditional-CREATE-ROLE suite): access, commands (21 §),
  concurrency 3/3 via overlap runner, legacy migration, create
  grant — all green.

Design notes: merchant headers cross-checked against Host (shipping
quote rule); forwarded-host never read; CSRF failures return uniform
typed `forbidden` instead of the csrf helper's shape; proxy needed no
changes (verified `/api` allowed on subdomains, security stage
covers the new paths).

Review handoffs: Phase A packet delivered (Tasks 1–2). Phase B packet
delivered (Tasks 3–4). Phase C packet delivered (Task 5). Phase D
packet after this commit; commits stay reviewable per task.

## Task 6 evidence

New: `apps/web/src/lib/cart/{handoff,handoff.test,merge,merge.test}.ts`;
`apps/web/src/app/api/storefront/cart/handoff/{route,route.test}.ts` and
`handoff/redeem/{route,route.test}.ts`;
`apps/web/src/components/storefront/cart/{cart-handoff.tsx,
cart-handoff.test.tsx}`;
`apps/web/src/components/storefront/ogabassey/pages/
cart-page-wrapper.handoff.test.tsx`;
`apps/web/mcp-server/cart-handoff.compat.test.ts`; migration
`20261012050500_commerce_cart_handoff.sql` (context columns + issue /
preview / redeem RPCs); `supabase/tests/commerce_cart_handoff.sql`
(18 sections) and `commerce_cart_handoff_race.sql` (redeem + issue
races). Modified: shared `CartErrorCode` (+`merge_conflict`,
`handoff_consumed`), `mutation-errors`, `repository`, `request-context`
(any-scope + quotas), `response` (host-only cookie), `schemas/cart.ts`,
`rate-limit-routes`, `cart-page-wrapper.tsx` (pairing mount),
`cart-link-tool.ts` (transfer description).

TDD (each RED recorded before GREEN):
- Handoff lib: deterministic HMAC token mint/parse, hash-only issue,
  replay passthrough, conflict parsing 17/17; merge planner (max qty,
  voucher/negotiation conflicts, cap) 9/9.
- Routes with real CSRF/proofs/quota/merchant-resolution and only
  anon-RPC + scoped-client seams mocked: issue+preview 9/9, redeem 8/8
  (incl. 409-with-conflicts, version refetch, consumed/expiry mapping).
- Component 6/6: fragment strip before fetch, preview render, gated
  connect with persisted-then-cleared attempt, merge/conflict/keep
  choices, consumed/expired screens. Two test-side fixes during GREEN:
  deferred redeem response (persist-then-clear spans the round trip)
  and a heading query (paragraph text matched twice).
- Wrapper 5/5: `#handoff=&hid=` mounts the continuation with decoded
  values, item transfer held while paired, incomplete/absent fragment
  falls through; existing 29 wrapper tests unchanged.
- MCP compat 2/2: old transfer URL shape + credential-free pin (GREEN
  on arrival), description one-time-transfer wording (RED→GREEN).
- SQL RED→GREEN: handoff suite 18/18 incl. new §18 (same key +
  different body conflicts); redeem race (A wins, B `handoff_consumed`,
  1 merge) and issue race (AI wins, BI `idempotency_conflict`, 1 grant)
  GREEN via throwaway overlap runners on disposable PG 18.6.
- §18 found a real bug: same op key + different body minted a second
  grant (hash-only convergence). Fixed with a `cc-handoff-op` advisory
  key lock + conflict branch per the Task 3 pattern; lock is taken only
  in issue after the hash lock, so no order inversion with redeem.
- Neighbors: 255/255 across 29 cart/schema/route/component/MCP files.
  SQL regressions green: access, commands (21 §), legacy, create
  grant, concurrency 3/3. Web + shared typechecks clean (7 Task 6
  errors fixed: nullable destCartId, conflict narrowing, tuple casts,
  real Response fakes). Biome clean on covered files; `mcp-server` and
  `ogabassey/**` are repo-config-ignored (pre-existing).
- Standalone boundary: tsx imports handoff/merge with zero web runtime
  imports; worker-boundary tripwire green.
- CodeRabbit pre-commit review unavailable (quota 3/3 used); gate
  incomplete, flagged for packet review.

Design notes: 5-minute single-use hash-keyed grants; deterministic
tokens make issue replays recompute the identical continue URL with no
stored secret (see deviation a); preview is anonymous GET by public
id, never consumes; redemption validates before knocking, consumes
only on success, persists the winning attempt receipt for
response-loss recovery; host-only HttpOnly merchant-namespaced
session cookie on redeem; secrets stay in the URL fragment (never to
the server) and out of logs/telemetry; /cart already noindex so the
continuation inherits it; merge consumes both snapshots + versions
transactionally with authoritative pricing; keep-existing leaves both
carts intact.

Deviations:
(a) Plan suggested a narrowly scoped *encrypted response receipt* to
preserve pairing-URL replayability. Implemented deterministic HMAC
tokens instead: replays recompute the byte-identical URL, so no
secret is stored anywhere (stronger than encrypting one). Grant table
holds only the hash; determinism + replay-convergence are pinned in
`handoff.test.ts` §issue and SQL §2.
(b) Plan named `mcp-server/cart-handoff.ts` for modification. No
behavioral change was needed: that tool is product-based with no
cart/principal context, so it cannot issue live-cart grants, and the
old transfer path is preserved byte-for-byte by design ("keep during
migration"). Covered by the new compat test; the transfer-vs-linked
wording landed in `cart-link-tool.ts` (which owns the description),
also closing the Task 4 description checkbox.
(c) No share/issue button added to the cart page: issuance exists as
lib + POST route; cart UI actions belong to Task 7.

## Task 7 evidence

New: `apps/web/src/hooks/cart/{use-shared-cart.ts,use-shared-cart.test.ts,
shared-cart-client.ts,shared-cart-client.test.ts,shared-cart-reducer.ts,
shared-cart-reducer.test.ts,storefront-cart-provider.shared-cart.test.tsx}`.
Modified: `storefront-cart-provider.tsx` (delegation),
`storefront-shell-frame.tsx` (+2 frame tests: enrollment wiring),
`cart-storage.ts`, `cart-persistence.ts`, `cart-types.ts` (display markers,
extension fields), `storefront-cart-provider.merchant-switch.test.tsx`
(+2 delegated navigation tests).

TDD (each RED recorded before GREEN):
- 7a storage/types: temp markers stripped on persist, display items extend
  CartItem, context extension fields (sharedCartEnabled/syncStatus/
  syncError/retryPendingSync).
- 7b reducer 42/42: optimistic FIFO queue, tempId→lineId resolution,
  version rebase (lower-version responses rejected within a generation),
  original retry keys preserved, failed-operation rollback, stale totals
  fenced by generation.
- 7c client 14/14: typed retryable/fatal mapping, no cartId travels on send
  (server resolves the cart from the session proof).
- 7d hook 29/29: cache-seeded instant display, adopt/reconcile, lazy
  creation on first action, one-time legacy import via Task 6 merge rules
  (receipt kept until success), failed-import explicit retry without
  duplication, reprice as remove-plus-add, display-local assurance,
  15 s jittered fallback poll + 60 s reconcile poll gated on visible
  surface with cartId, hidden-tab stop, late-response fencing by
  sessionGeneration. Two real bugs found by tests: fatal import sends
  never flipped importStatus to failed (finishImportOp now reports the
  outcome); stale-retry snapshot versions are ignored (test data fixed,
  reducer guard confirmed).
- 7e provider delegation 13/13 + frame 2/2 + switch 2/2: enrollment binds
  merchantId to the served slug (server-evaluated `shared_cart` grant);
  unenrolled merchants and missing flags stay fully local with zero
  server calls; legacy add gating (default-variant resolution, voucher
  stock exemption, out-of-stock/unresolved-variant blocks) extracted to
  `gateAddToCart` and shared by both modes; legacy hydration/persist/
  validation effects fenced while delegated; every slug change bumps the
  session generation; group negotiation emulated as proportional
  per-line server reprices with legacy void semantics (void clears queue
  ahead of the edit except the edited line, whose line ID must stay live;
  quantity updates queue ahead with clamped re-add quantities).

Gates: `vitest run src/hooks/cart` 155/155 (11 files); handoff + cart +
storefront sweep 2305/2305 (416 files); `tsc --noEmit` clean;
`biome check` clean (814 files incl. frame).

Deviations:
(a) No server group-deal operation exists (Task 3 has per-line
negotiation only), so cart-wide negotiation is provider-emulated via
N remove-plus-add pairs with the legacy ratio math. Remote voiding
(another device editing mid-deal) is not implemented: confirmed
per-line prices stand, the flag clears on local edits. Recorded as a
pilot limitation; a server op or Task 8 event can close it.
(b) Delegated voucher adds pin quantity 1 per the Task 6 merge rules;
legacy keeps its unpinned behavior. Intended server-authoritative
divergence, flagged for 11A checkout review.
(c) Legacy update-to-no-match quirk mirrored exactly (flag drops,
prices stay) so both modes share one behavior instead of diverging.

Pre-commit review gate (Task 7): `coderabbit review --agent -t
uncommitted` completed on all 18 Task 7 files with 7 findings, each
verified against current code and fixed with TDD (13 new tests: 1
reducer + 12 hook):
- Queue stall on repeat edits (major): set_quantity claimed the op id
  as pendingTempId, so a second edit blocked on a temp only an add
  reconcile resolves. Reducer no longer claims temps on edit;
  targetForLine prefers a stable serverLineId.
- ensureCart stranding (major): provisioning failures returned a bare
  false, parking the head entry with no timer. ensureCart now returns
  real {code, retryable} detail (null only when the generation moved
  on); the sender surfaces it via command/failed so the retry loop
  and retryPendingSync own recovery, and every create failure
  releases the attempt latch (stable op key replays safely).
- Cross-merchant cache write (major): the persist effect now skips
  the transition commit where reducer state still belongs to the
  previous generation.
- Hidden-mount stall (major): adoption waits for the first
  visibilitychange instead of returning early; foreground refresh
  yields the first fetch to adoption.
- quizAwardId voucher gap (minor): hook stock exemption + qty pin now
  match gateAddToCart.
- Import settle on drop (minor): prune-based settlement fails the
  import (with the live syncError code) when tracked ops leave the
  queue via conflict-cap drops, cascade drops, or fatal refetch
  failures.
- Poll/reconcile hydration (minor): hydrateMissing moved to hook
  scope with a link-run fence and is called after adopt, poll,
  foreground refresh, and reconcile; ids filter against the latest
  snapshot seen (the reducer's confirmed copy is null pre-adopt and
  stale in the dispatch lag window).

## 2026-10-14 coordinator continuation

Owner authorized fixing integration failures and resuming the remaining plan,
with no deployment or live orders. The prior review/UUID fixes remain staged.
The attempted local commit did not occur: its lint hook observed the pending
registry edits before formatting; HEAD remains `33a9a265c4`.

Integration work:
- Registered all eight canonical-cart migrations as pending replay sources,
  with independently pinned test hashes; no deployment receipt was invented.
  Four targeted registry/materialization suites passed (33 tests).
- Recorded exact cart scoped-signing authority paths, preserving rejection of
  sibling routes and all service/admin factories (focused RED then 3/3 GREEN).
  Refreshed the reviewed orders route content receipt for transaction binding.
- Split oversized cart lifecycle, queue, display, import, transport, handoff,
  merchant resolution, quota and envelope parsing into focused modules.
  Existing behavioral tests were relocated with those responsibilities; public
  entrypoints remain compatible. New authority/recovery tests are colocated.
- Targeted regression run: 65 files / 468 tests passed. Full monorepo lint:
  4/4 tasks passed. Web TypeScript passed. Live event boundary passed; the
  analytics validator is being repeated against the newly staged source view.
- Frozen committed-source inventory and clean-tooling tests still require a
  reviewed local commit plus a regenerated repository snapshot. Their
  fail-closed semantics remain intact.
- CodeRabbit failed to start twice and also failed with `--fresh`. Its required
  review gate is unavailable, so new work remains local/uncommitted. No review
  success is claimed for this integration patch.

Task 8 started with version/event validation RED tests. Production realtime
remains disabled; no remote configuration or cart/order data has been changed.

Continuation verification:
- The repeated staged-source analytics authority suite passed all 13 tests.
  Working-tree runtime size/colocation analysis returned no findings.
- Task 8 foundation: notification validation and version/identity reconciliation
  demonstrated 3 failing tests before implementation; all 49 shared-cart tests
  passed afterward. This is not the full realtime transport implementation.
- A receive JWT outlived a proof with only 30 seconds left (RED: 300 vs 30).
  Scoped JWT expiry now uses the earlier of proof expiry and five minutes;
  invalid/expired proof input fails closed. The original 5 scoped-client tests
  passed after the fix; additional invalid-expiry cases were added.
- CodeRabbit usage showed included reviews available. A narrower hooks-only
  review also failed to start, so this is not an exhausted review allowance or
  an accepted clean review. Required review/commit remains blocked; remaining
  full transport, mobile/account/UCP integration and release qualification tasks
  are unfinished. No merge, deployment, remote migration, live cart mutation,
  or order was performed.

### Task 8 local implementation and Task 9 recovery foundation

Task 8 now has a local receive-only route, isolated browser subscription,
explicit merchant enrollment gates, and a transactional SQL outbox publisher.
The new pending migration is `20261014070000_commerce_cart_broadcast.sql`;
nine cart migrations are registered as pending, not deployed. The publisher
wrapper and disabled systemd configuration are prepared only. No remote unit,
environment, migration, or feature flag was changed.

Local SQL regression tests passed for exact tenant/cart topic access, revoked
or expired grants, permissive legacy PUBLIC policies, receiver write denial,
authenticator role membership, four-field event projection, swallowed-send
backoff, rollback, duplicate replay, and exhausted-retry dead letters. Tests
used a disposable local PostgreSQL fixture with a stub realtime schema; they
are not proof of actual Supabase private-channel/custom-role compatibility.
Real transport qualification with two linked clients remains open, and
realtime must stay disabled until that gate passes.

Task 8 focused web/cart regressions passed (69 files / 465 tests), and web
TypeScript passed. A further lifecycle regression demonstrated that version
changes incorrectly reconnected while generation changes did not; the effect
now reconnects by generation and keeps its channel across version changes.
Renewal also accounts for time spent opening the connection.

Task 9 is in progress, not complete. Added tenant-keyed serialized SecureStore
proof storage, a dedicated Expo fetch transport with bounded bootstrap and
mutation requests, strict snapshot/merchant validation, and generation fences.
It preserves customer Auth credentials and does not bootstrap on read failure.
A single pending request uses bounded ASCII SecureStore chunks and a committed
manifest before transmission. The coordinator serializes edits, replays the
same saved operation/body after response loss, holds later edits behind an
unresolved request, and refuses recovery under a different principal. No
native cart UI, legacy-writer replacement, app-link pairing, AppState adapter,
account continuity, or native checkout binding has been activated yet.

Native receipt/coordinator/bootstrap regressions were observed RED before
implementation and GREEN afterward. The focused native cart run passed
52 tests across 8 suites; native TypeScript passed. Bootstrap's native CSRF
cookie/header handshake still requires actual iOS/Android qualification.
No live cart, order, payment, or shipment operation was performed.

The required CodeRabbit review remains unavailable after four failed starts
(including fresh and narrowed runs), despite included review allowance.
No commit or clean-review claim has been made for this continuation. The
committed-source inventory and clean-tooling integration gates still need a
reviewed commit and regenerated snapshot; their assertions were not weakened.
Remaining plan work: finish Task 9, then Tasks 10, 11B, 12, 13 and 14 locally,
respecting deployment and production activation holds.

Latest continuation checks:
- Web/cart focused regression: 68 files, 463 tests passed.
- Native cart regression: 8 suites, 52 tests passed.
- Monorepo lint: 4/4 tasks passed, existing 7 native warnings.
- Monorepo TypeScript: 6/6 tasks passed.
- Native platform drift: passed, no new forbidden patterns.
- Publisher shell syntax and disposable PostgreSQL realtime suite passed.
- Final CodeRabbit attempt again returned non-recoverable “Failed to start
  review”; no review results were produced. The required review gate remains
  blocked. The owned disposable PostgreSQL server was stopped afterward.
- Full monorepo test success is not claimed: frozen committed-source inventory
  and dirty-tooling checks are still unresolved pending the reviewed commit.
- The live boundary scan found the receive-authority helper itself needed an
  exact scoped-signing ledger path. A frozen-source graph regression reproduced
  the failure, then passed with that one path recorded (8 total cart paths).
  Sibling-route and service-factory rejection tests still pass. The live scan
  is being repeated; no broader credential permission was added.
- Final live event-pipeline boundary verification passed (154 seed paths)
  after the exact helper-path fix. Final monorepo lint again passed 4/4 tasks.

### Owner-authorized continuation while CodeRabbit is unavailable

The owner explicitly authorized continuing implementation and retrying the
required review later. No commit/release gate was waived, and no deployment
or live orders are authorized.

Task 9 now has local controller/store integration (still explicitly disabled
unless both `shared_cart` and `shared_cart_native` are enrolled for the exact
configured merchant). Added a single writer owner covering direct Zustand
mutations and the optimistic hook; stale legacy rollback/rehydration cannot
replace confirmed canonical state. Confirmed cache metadata is merchant-bound.
The controller performs lazy provisioning only on intent, serializes commands
against the latest confirmed version, preserves options/voucher/negotiation
attachments, hydrates through the merchant-filtered public product projection,
and blocks checkout readiness while metadata or sync is incomplete. Assurance
remains a display-local overlay, matching the web adapter until checkout review.

Added explicit legacy cart selection, foreground recovery and foreground-only
HTTP polling. SecureStore records now atomically retain proof-promotion receipts
for creation and handoff. This closes the crash window between saving the new
proof and clearing the durable request. Historical receipt recovery refetches
current state; definitively rejected command keys are released, while uncertain
outcomes retain the same request/key. All native cart actions remain separate
from order/payment submission.

Trusted HTTPS `/cart#handoff=...&hid=...` links are intercepted by Expo Router's
native-intent boundary. Tenant mismatch, untrusted hosts/ports, malformed or
duplicate secrets and query-string secrets are rejected/stripped before routing.
Pairing secrets remain ephemeral or in the single secure pending request, never
route/query cache state. The pairing modal previews by public handoff id before
explicit connect/merge/keep-current choice. Web-bound grants offer a trusted
browser fallback and are never redeemed as native grants. No automatic browser
opening or native redemption occurs from a link preview.

Verification: native focused regression passed 42 suites / 201 tests; native
TypeScript and platform drift passed. Subsequent historical-replay/conflict
regressions were observed RED then GREEN. Actual iOS/Android app-link delivery,
native CSRF handshake and private Realtime transport remain qualification gates;
no remote feature was enabled. CodeRabbit remains pending.

Task 10 started: added a new pending account-continuity migration with a
self-revocation RPC. Disposable PostgreSQL tests prove device/merchant isolation,
idempotent revocation and unchanged shared cart contents. The new private POST
session-revoke boundary validates CSRF, empty input and the resolved proof;
its focused service/route tests pass. Optional account linking, local teardown,
and authenticated cross-device selection are still being implemented. The
owned disposable PostgreSQL cluster currently runs on Unix socket
`/tmp/cart-realtime-review-sock`, port 55439, with no TCP listener; stop it before
ending the session. The tenth migration must be added to pending replay hashes
once this new migration is finalized.

### Further continuation: account transactions, device retirement and native provenance

Task 10 remains **in progress**, not complete. Five additive account/device/
permission/merge migrations are now registered as **pending** (14 cart migration
sources total); registration is not deployment evidence. A normal customer Auth
request and its independently verified cart proof are required for the account
API (`/api/storefront/cart/account`). Native requests retain the shopper JWT in
Authorization and provide the cart proof separately; malformed explicit proofs
cannot fall back to a cookie. Customer lookup uses merchant + Auth user ID under
RLS, never email. Account operations remain gated by explicit `shared_cart_accounts`
enrollment; no feature was remotely enabled.

The account SQL transaction creates fresh device grants and a fresh principal,
performs the reviewed two-cart merge and updates the account pointer atomically.
Failed merges roll back the grants, handoff and pointer. Finished operations replay
against the original request even if promotion revoked its original grant. Device
roots survive principal rotation: logout using the old proof revokes only that
root's grants, including grants minted by an in-flight promotion. Retirement is
serialized with account linking, guest creation, mutations and handoff redemption;
a retired bootstrap proof cannot recreate authority. Expired signed proofs may
mint only the narrow revocation role, never shopper/account/realtime authority.

Stored mutation permissions are now enforced in the database. Empty permissions
mean deny-all. New standard grants include `replace`; existing restricted grants
are not upgraded. Merge input requires both reviewed versions and the complete
union. Same-identity duplicate voucher lines are rejected for explicit source
editing instead of silently dropping a line. The pure merge planner is shared
between web and native. Native legacy imports now use it instead of concatenating
overlapping identities.

Native logout/account switching invalidates pending callbacks synchronously,
clears private local projection and checkout generation, and retires the device
without sending a server `clear` command. SecureStore retains an atomic retirement
marker while revocation is offline; active reads cannot restore that proof, and
late writes cannot overwrite the marker. A fresh bootstrap first reconciles the
retirement. Pending operation cleanup occurs only after confirmed retirement.
Actual account-link client/UI integration still needs owner-subject metadata and
promotion recovery; do not treat this partial lifecycle as qualified for rollout.

Task 11B has started at the payload boundary: native request validation, outbound
payloads, credit-snapshot delegation and queued replay retain `shared_cart` and
canonical `cart_line_id`. A bound request with missing/duplicate canonical line
IDs fails validation. Checkout preparation/review hooks and final screen wiring
remain pending; this is not end-to-end native checkout verification.

Latest checks: 301 web tests (47 files), 175 native tests (26 suites), and 59 shared
cart tests (4 files) passed. The live event boundary verifier passed (154 seed
paths). Disposable SQL account linking/merge/retirement and restricted-permission
fixtures passed with transactional rollback. Full monorepo lint/typecheck is being
rerun after correcting a CSRF mock shape; record its final result below. Whole
monorepo tests, platform/device qualification, CodeRabbit, Tasks 11B completion,
12/13/14 and optional native Realtime qualification remain open. No commit,
deployment, remote migration, customer cart mutation or order was performed.

Follow-up validation: monorepo lint/typecheck passed all 10 tasks (existing lint
warnings remain). Native platform drift passed. The native order service now
rejects a missing or wrong-cart binding when a device has canonical ownership,
before network/Auth/order side effects; ordinary unlinked guest checkout remains
unchanged. This deliberately blocks canonical native submission until Task 11B's
review wiring is implemented, rather than permitting a legacy fallback. Two
focused fence tests pass; the existing order-service regressions are being run.

Final checkpoint: existing mobile order-service regressions passed 25 suites /
118 tests, and the final monorepo lint/typecheck rerun passed 10/10 tasks. The
account SQL regression passed again, including retired-bootstrap rejection.
The owned disposable PostgreSQL cluster was stopped successfully. CodeRabbit
has not been retried or marked passed. Implementation remains incomplete at the
Task 10 account client/UI promotion-recovery work and Task 11B checkout review
wiring; later tasks and device qualification remain as listed above.

### Continuation 2026-10-14 (second agent, coordinator-review handoff)

All work below is local and uncommitted on `codex/shared-server-cart`
(HEAD unchanged at `33a9a265c4`). No deployment, remote migration,
customer-cart mutation, order, payment, or feature enablement occurred.
CodeRabbit was not run in this session; its review remains **pending**.

Task 9 edges completed:
- Durable command recovery now releases definitively rejected keys per
  request kind (command/create/handoff/account) while uncertain outcomes
  keep the exact operation/body for replay. Observed RED (2 tests) then
  GREEN in `command-coordinator.test.ts`.
- Explicit new cart after a completed/expired/canceled generation:
  native controller clears the display, never offers the finished cart
  for checkout, and on the next write intent restarts the session
  (retirement flushed first) and creates a fresh cart. Native realtime
  stays HTTP-recovery only (foreground refresh + 30 s poll); the unused
  `/realtime` route type was removed and unqualified transports remain
  disabled.
- Legacy import/conflict UI: native legacy merge accepts per-line offer
  resolutions (`SharedCartStatusPanel` choice flow); web exposes
  `importConflicts`/`resolveImportConflicts` through the cart context
  with a `CartImportConflicts` panel on the cart page.

Task 10 completed (client/UI layer):
- Web: `shared-cart-account-client` (saved-cart read, explicit link,
  device revoke), `use-cart-account-link` (one stable operation id
  until the link settles), and a `CartAccountLink` panel with
  keep/use-saved/merge choices. Native: `NativeCartAccountPanel` with
  the same choices; shopper JWT and cart proof travel in separate
  headers and are never substituted.
- Native proof records now store atomic owner-subject promotion
  metadata (`kind: 'account'`, `ownerSubject`); committed-link recovery
  only proceeds for the same owner subject, cart, and operation, and
  account links replay through the durable pending request with the
  same operation/body (no credential is persisted in that request).
- Web sign-out now revokes the device's cart grants before clearing
  local state, so back navigation cannot restore the previous
  customer's context. Sign-out never clears the shared cart itself.
- Regression pinned: the save-details checkbox only toggles local form
  state and fires no account/auth request.

Task 11B completed:
- Native `prepareCheckout` transport + strict checkout-snapshot schema,
  `use-cart-checkout-snapshot` preparation/review hook (preparation
  never submits an order or starts payment), and checkout-screen
  integration. Cart edits invalidate the review; stale reviews return
  to the review step.
- Only remaining, available reviewed lines enter a bound order.
  `shared_cart` + per-item `cart_line_id` are now produced by the
  submit builders (including BNPL) and preserved through validation,
  credit freezing, and queued replay; canonical carts never downgrade
  to legacy checkout after an error. Assurance stays the established
  display-local overlay (the server ignores it on replace), while
  order items continue to carry `has_assurance`.

Tasks 12–14 (local scope):
- UCP: platform replacement, cancel, and reads are now gated — a
  migrated (shared) cart returns `409 refresh_required` with the
  canonical cart id, and a recorded caller mismatch is hidden as 404.
  Pinned `2026-04-08` fixtures and `lib/cart/ucp-adapter.ts` record the
  contract. Still open: full canonical-service delegation for
  unmigrated platform carts, the transfer-vs-checkout readiness split,
  and official re-verification of the pinned profile before any
  external enrollment claim.

Task 12 continuation (same day, second continuation):
- Unmigrated UCP writes now go through the adapter: replacements are
  planned with the canonical `validateCartCommand` contract and applied
  under an optimistic `updated_at` version precondition; a stale
  replacement loses with `409 {code:'version_conflict'}` (logged,
  nonsecret) instead of overwriting a newer cart. Observed RED (6
  tests across adapter/idempotency/profile/routes) then GREEN.
- Receipt scoping: new append-only migration
  `20261014130000_agentic_idempotency_caller_scope.sql` (pending,
  independently hashed, registered in both pending-source registries)
  scopes idempotency records by verified platform caller; cart routes
  pass `mutation.agentId` through reserve/lookup/reclaim/store.
  Validated on a disposable PostgreSQL cluster owned by this agent
  (started, proven — cross-caller insert allowed, same-caller
  conflict — and stopped).
- Readiness split: cart creation no longer requires native checkout
  enablement; the discovery profile advertises
  `dev.ucp.shopping.cart` on signed agent auth alone, and universal
  readiness reports separate `cartTransferReady`/`checkoutReady`.
- Tasks 13–14 local additions: a two-context browser concurrency spec
  (`tests/checkout-browser/shared-cart-concurrency.pw.ts`, authored and
  listing-verified; execution against the fixture stack pending), a
  version-race log signal, and updated acceptance/rollout docs. A
  platform-principal delegation into the canonical RPC service remains
  future work (needs its own scoped role and SQL proof) and is recorded
  as such rather than simulated with a privileged client.
- Acceptance and rollout documents added
  (`docs/qa/shared-cart-acceptance.md`, `docs/deploy/shared-cart-rollout.md`).
  Cleanup already spares active checkouts/unexpired receipts; no new
  migration was needed or added in this continuation. Production
  metrics/dashboards remain a release-time gap, recorded honestly in
  the rollout doc.

Full-suite record (2026-10-14, second continuation):
- Native full run: 1,458 of 1,462 suites passed; all 8,636 tests that
  ran passed. Four suites failed to load
  (`stores/auth-store-date-of-birth.test.ts` plus three suites in the
  same import chain): the first agent's `clear-device-cart.ts` imports
  the native `expo-crypto` module, whose nested `expo-constants` copy
  crashes in Jest for suites without a factory mock. This predates the
  continuation (none of its files are in those import chains). Fixed at
  the shared layer with a Node-backed `__mocks__/expo-crypto.js`
  mapped in `jest.config.js`; suites with explicit factory mocks keep
  them. RED→GREEN observed on the affected suites and on crypto
  consumers (quiz, checkout attempt keys, ad tracking, cart).
- Web full run: see the terminal counts recorded below.

Verification (this continuation, after final edits):
- Monorepo lint 4/4 and typecheck 6/6 (10/10 turbo tasks), existing
  warnings only.
- Web: 80 files / 506 tests across hooks+lib cart, cart API routes and
  agentic cart routes.
- Native: 65 suites / 315 tests across cart, checkout builders/submit,
  and order services; platform drift passed.
- Shared package cart: 59 tests. Event boundary verifier suites passed.
- No disposable PostgreSQL cluster was started by this agent; the
  pre-existing unrelated probe listener on port 55439 was left
  untouched. Full monorepo tests, device qualification, two-client
  realtime convergence, and CodeRabbit remain pending.


## Coordinator review — 2026-10-14

The continuation was reviewed and corrected without committing or deploying.
See [the detailed review](2026-10-14-shared-cart-agent-review.md) for validated
findings, regression evidence, external-review disposition and remaining gates.

The previous account/checkout claims require the owner-bound recovery, exact
retry-body, reviewed-price and late-response fixes recorded there. Unavailable
reviewed lines now block checkout; they are never silently omitted. The native
checkout display-local assurance overlay remains unchanged.

A further append-only pending migration,
`20261014140000_agentic_cart_revision_guard.sql`, makes UCP's timestamp CAS
strictly advance for every writer; both pending registries contain its hash
(17 pending sources, including the checkout-lifetime correction below). Disposable local SQL demonstrated the failure without
the trigger and success with it. No remote migration was applied.

Current verified checks: shared full 1,612 tests; final focused web 540 tests;
final focused native 150 tests; Chromium and WebKit stale-removal checkout;
seven local SQL checks; and all 10 monorepo lint/typecheck tasks. The broad
native run passed 8,665 tests but one worker crashed; its affected suite then
passed alone. Broad web authority checks require the eventual clean committed
candidate and are not bypassed. No real order, payment or deployment occurred.

SQL review also identified a near-expiry checkout whose new session could
outlive its cart. `20261014141000_commerce_cart_checkout_lifetime.sql` preserves
the existing prepare authentication/replay contract and extends cart expiry
through the accepted session. Its local regression failed before the correction
and passed afterward. The large-total assertion now rejects missing results.
The final disposable cluster was stopped; all seven SQL groups passed again.

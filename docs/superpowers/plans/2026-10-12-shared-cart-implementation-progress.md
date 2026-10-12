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
- [ ] Tasks 7–14 per dependency order
  (7 → 11A → 8 → 9 → 10 → 11B → 12 → 13 → 14)

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

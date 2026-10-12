# Draft to canonical binding: parent review

Status: source foundation only; migration UNAPPLIED and UNREGISTERED. No provider,
database, secret, production, authentication, UI or startup operations performed.

## Decision and exact boundary

This binds an accepted exact-catalogue draft to an **existing** isolated canonical
goal. It does not create the goal, stage a quote, copy consent, or prepare duration.
The existing goal must already be paused/manual, zero-funded, unexposed, without
canonical consent, activation, schedules, ledger operations or conflicting intents.
Existing legacy columns are never changed or interpreted as canonical consent.

Creating a new goal from the current draft remains an architectural decision:
the full public schema requires legacy non-withdrawable consent, contribution
amount/frequency and maturity date that this draft does not establish. The existing
activation path also compares maturity with actual activation date plus duration.
Neither invented placeholders nor relaxed legacy constraints are included here.

The new SQL function requires the existing `piggyvest_staging_policy_writer`
session login, a Unix socket, database `piggyvest_local`, and READ COMMITTED via
the canonical scope lock. It explicitly rejects `postgres`, including local
Supabase's ordinary database. No cross-database copy, SET ROLE substitute,
connection string or new grants are supplied. The parent must choose a reviewed
co-located Auth/public/canonical test environment or separately design the bridge;
identical UUIDs in different databases are not proof of shared identity.

## New artifacts and contract

- `supabase/migrations/20260913130000_customer_savings_canonical_binding.sql`:
  private RLS-denied immutable receipt table and `savings_draft_private.bind_canonical`.
- `draft-canonical-binding-statements.ts`: pending exact statement descriptor;
  intentionally not added to the shared PostgreSQL statement registry.
- `draft-canonical-binding-store.ts`: strict input/output adapter, redacted failures,
  no internal retry and no connection creation. Its injected executor is trusted;
  configuration validation is not authentication or proof of an actual session.
- `src/schemas/piggyvest-draft-canonical-binding.ts`: strict boundary and receipt schemas.

SQL parameter order: integration UUID, merchant UUID, customer UUID, goal UUID,
business text, authenticated actor UUID, draft UUID, draft revision UUID, canonical
policy revision UUID. The first six must be server-resolved; the last three are
selections checked against persisted ownership and canonical state.

Result: `{draftId,draftRevisionId,goalId,policyRevisionId,outcome:'bound',boundAt}`.
It proves the binding ceremony only, never current funding/consent/activation.
Repeated binding revalidates eligibility; expiry, later consent or lifecycle changes
can reject a retry. A future read-only link/status projection is parent integration
work; do not treat an old receipt as financial eligibility.

Locks follow existing integration/ledger/policy/customer/goal scope, then merchant,
settings/draft and catalogue. Goal and draft locks serialize both uniqueness axes.
Unique constraints additionally protect draft, goal and revision identities. All
changes roll back on failure. Catalogue is re-read under its existing product and
variant locks; exact IDs, price/condition/name, terms and current revision are checked.
The command delegates unexposed/unfunded lifecycle checks to existing draft closure
logic. No existing function, migration, role guard or public table is modified.

## Tests and parent-only database execution

TDD adapter run: 13 failing assertions before implementation, then 25 tests passed
across adapter/schema/statement suites. Four replay-harness boundary tests passed
without opening a database. These are not PostgreSQL behavioral results.

Authored, NOT RUN:

1. `supabase/migrations/tests/customer_savings_canonical_binding.sql` requires the
   reviewed migration and existing dependencies in a disposable full-schema
   `piggyvest_local` socket database. Parent supplies a fresh synthetic accepted
   draft and matching unconsented canonical goal, plus `integration`, `merchant`,
   `customer`, `goal`, `business`, `actor`, `draft`, `draft_revision`, `revision`
   psql variables. Run as the fixture owner with reviewed test-only USAGE/EXECUTE
   grants for the existing writer; grants are not installed by this migration.
   The suite rolls back, checks identity/tenant/revision failures, missing consent,
   stale catalogue/price/goal, disabled terms/settings, funded goal, canonical
   consent rejection, immutable receipts, identical replay and no money/legacy writes.
2. `tools/test/draft-canonical-binding-replay.mjs` exports a harness, not a launcher.
   Parent supplies `openWriter`, `openObserver`, reviewed `restart`, `rollback`
   parameters, and three disjoint fresh `{winner,contender,conflict}` fixtures:
   duplicate request; one draft/two matching goals; one goal/two matching drafts.
   Parameters use the SQL order above. The observer needs fixture read and lock
   visibility; each writer is a real restricted socket login. The harness requires
   observed `pg_blocking_pids` contention, commit/rollback verification, and equal
   persisted receipts after the parent performs a real restart. It creates no
   database, role, schema, fixture, credentials or network transport.

3. `supabase/migrations/tests/customer_savings_canonical_binding_rejections.sql`
   takes the same accepted draft/scope plus four parent-prepared canonical
   fixtures: `expired_goal`/`expired_revision` (expired stored quote),
   `wrong_price_goal`/`wrong_price_revision` (different quoted kobo),
   `wrong_device_goal`/`wrong_device_revision` (different exact selection), and
   `exposed_goal`/`exposed_revision` (synthetic persisted provisioning/mapping).
   All other prerequisites must match so each rejection exercises its named
   condition. No test makes a provider call or changes a clock/guard. Each must
   raise 23514 without adding a binding.

Full-schema SQL application, negative-fixture execution, actual lock
wait/restart results and independent SQL review remain unverified. Do not call
the persistence/concurrency requirement complete until parent-run tests pass.

## Remaining integration

Parent review must precede migration application, exact statement registration
and narrowly granting only the wrapper to the existing writer. The wrapper calls
existing private functions as its owner; it does not need broad table grants for
the caller. Keep authenticated/anon/service-role access denied.

Parent owns server authentication/tenant resolution, goal creation architecture,
real local database alignment, status projection, UI, native bearer adapter and
runtime startup. Binding does not solve those connections or enable money.

Final source checks: root typecheck passed after correcting the two new test typing
errors (literal-union comparison and Vitest array-case spreading). Scoped Biome
passed. Root lint attempted and failed on three concurrent out-of-scope errors;
see `/private/tmp/draft-canonical-binding-lint.log`. Root typecheck evidence is
`/private/tmp/draft-canonical-binding-typecheck.log`. No full-suite or database
pass is claimed; SQL fixtures require parent review/application first.

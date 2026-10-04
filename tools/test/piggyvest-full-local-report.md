# Full registered PiggyVest draft replay — local evidence

Verified 2026-09-12 with PostgreSQL 18.6 (Homebrew). Ready for parent review.

## Reproduce

From `/Users/mac/Baci-worktrees/cursor-savings-phase1`:

```sh
node --test tools/test/piggyvest-full-local-plan.test.mjs
bash -n tools/test/piggyvest-full-local.sh
bash tools/test/piggyvest-full-local.sh
```

All exited 0. Node tests: 5 passed, 0 failed (76.689375 ms on final run).
The shell prints each replayed filename and verified SHA-256, then:

```text
PASS private schemas=3 tables=15 routines=40; RLS and denied PUBLIC/anon/authenticated/service_role/probe ACLs
PASS rejected injected grant (transaction rolled back on disconnect).
PASS rejected injected rls (transaction rolled back on disconnect).
PASS private schemas=3 tables=15 routines=40; RLS and denied PUBLIC/anon/authenticated/service_role/probe ACLs
PASS 28 registered staging drafts; ACL/RLS checks before and after restart; synthetic baseline only.
```

The private-schema lines are PostgreSQL NOTICE messages. Complete final run output was captured locally at `/tmp/piggyvest-full-local-output.txt`.

## Discovery and integrity

- Source: `apps/web/tools/db/supabase-history-replay-savings-pending-sources.ts`.
- Registry SHA-256 at verification: `55482a5badd23f49278eff9ff5be96667c879f403026df986b8ddc0eb930488e`.
- Strict data parser, no evaluation/import of registry JavaScript. Rejects malformed rows, paths, duplicate timestamps, missing files, empty staging scope and hash mismatches.
- Selects registered `_piggyvest_` and `_goal_policy_` filenames plus the exact timestamp-following `goal_lifecycle_` and `cancel_plan_` prefixes, orders by migration timestamp, verifies every selected file before starting PostgreSQL, then replays private copies of those exact bytes.
- Current range: `20260912090000_piggyvest_staging_webhook_inbox.sql` through `20260912140300_goal_policy_canonical_commands.sql`. Six legacy savings-repair entries are intentionally excluded.
- No hardcoded migration list or hash updates. Future registered lifecycle entries using the same naming convention are discovered automatically; rerun after parent registration. Unknown registry syntax or new permissive RLS policy fails for review.

## Safety and checks

- Disposable `/tmp/baci-piggyvest-full.<suffix>` cluster, private Unix socket, no TCP listener, no credentials or env-file reads. Ambient libpq connection overrides are unset; connection parameters are explicit. Only owned cluster/data are stopped and removed; failed stop retains data rather than deleting it.
- Minimal public fixture: merchants, customers, products, variants, savings goals and contributions. No production rows. All fixture tables have RLS enabled.
- Synthetic `anon`, `authenticated`, `service_role` are NOLOGIN placeholders. The service-role placeholder has BYPASSRLS to test the real risk boundary: schema, table and function ACLs still deny it. It is never used as caller.
- Synthetic probe is non-superuser, NOINHERIT, NOBYPASSRLS, cannot create roles/databases, and has no role memberships. Checks verify no PUBLIC or caller access across the three private schemas, all 15 tables and all 40 routines; SECURITY DEFINER search paths must be `pg_catalog`.
- Actual probe queries/RPC are refused before grants. A transaction-local synthetic SELECT grant still cannot see an inserted registry row under RLS.
- Exact transaction-local enqueue grant refuses a default-disabled integration with the expected SQLSTATE/message; explicitly enabling that synthetic integration permits one inert `{}` inbox body and returns duplicate on replay. No event processing or provider calls occur.
- Injected authenticated schema grant and disabled RLS each make the checker fail for the exact expected reason. Both mutations roll back on disconnect. Baseline checks pass again after PostgreSQL restart.
- All test grants, synthetic registry rows and inbox writes roll back; this checks persisted migrated schema/security after restart, not business-record durability.

## TDD and limits

Planner tests first failed RED with missing planner module, then passed after implementation. Five tests cover ordering/exclusion, altered bytes, duplicate/malformed/path/empty inputs, injected code and missing source files. Real replay initially exposed an overly strict harness assertion rejecting existing deny-false RLS policies; the checker now allows only explicit false/false policies or default-deny absence. No migration changed.

This is **not a full production-schema replay**, not a Supabase authentication test, and not provider/financial workflow acceptance. It proves the currently registered staging drafts compose on the documented minimal public baseline and retain deny-by-default access. Existing per-slice executor, ledger, policy and recovery tests remain separate evidence. No production role provisioning, migrations, registry hashes, original runtime scripts, manifests, env files or lockfiles were edited. No full monorepo checks, remote database access, deploy or commit occurred.

Files added: `piggyvest-full-local.sh`, `piggyvest-full-local-plan.mjs`, `piggyvest-full-local-plan.test.mjs`, `piggyvest-full-local-fixture.sql`, `piggyvest-full-local-checks.sql`, and this report, all in `tools/test/`.

## Lifecycle discovery regression

Two additional synthetic registry tests first failed against the old filter: lifecycle entry omitted from the ordered plan, and altered lifecycle bytes silently skipped. Both pass with exact `YYYYMMDDHHMMSS_goal_lifecycle_` prefix support. Similar embedded or longer prefixes remain excluded. The planner suite now has seven passing tests. Lifecycle SQL was not registered at this follow-up check, so the earlier 28-draft SQL evidence does not include lifecycle activation. Parent must rerun the harness after registering that migration; no registry or migration edits are part of this fix.

## Latest: cancellation discovery and dynamic schema coverage

Added exact timestamp-following `cancel_plan_` discovery. Two regression tests first failed for missing cancellation inclusion/hash verification, then passed. All nine planner tests now pass. A real-PG regression first failed with `FAIL security checks accepted injected cancel_grant` against the old fixed schema list.

The checker now iterates every schema matching `^piggyvest_`, including `piggyvest_cancel_plan`, while still requiring the original three named schemas. Counts are measured, not hardcoded. Transaction-only regressions prove rejection of cancellation-schema grants, missing RLS on a cancellation table, PUBLIC execution on a cancellation routine, and a renamed/missing original schema. An additional safe synthetic schema proves the reported schema count increases. These synthetic mutations all roll back and do not constitute cancellation migration replay.

Latest commands (all exit 0):

```sh
node --test tools/test/piggyvest-full-local-plan.test.mjs
bash -n tools/test/piggyvest-full-local.sh
bash tools/test/piggyvest-full-local.sh
```

Latest replay output, captured at `/tmp/piggyvest-full-local-cancel-green.txt`:

```text
PASS private schemas=3 tables=19 routines=46; RLS and denied PUBLIC/anon/authenticated/service_role/probe ACLs
PASS rejected injected grant (transaction rolled back on disconnect).
PASS rejected injected rls (transaction rolled back on disconnect).
PASS rejected injected cancel_grant (transaction rolled back on disconnect).
PASS rejected injected cancel_rls (transaction rolled back on disconnect).
PASS rejected injected cancel_routine (transaction rolled back on disconnect).
PASS rejected injected missing_original (transaction rolled back on disconnect).
PASS dynamic schema coverage count=4 (synthetic extra schema rolled back).
PASS private schemas=3 tables=19 routines=46; RLS and denied PUBLIC/anon/authenticated/service_role/probe ACLs
PASS 30 registered staging drafts; ACL/RLS checks before and after restart; synthetic baseline only.
```

The registry now includes both lifecycle migrations, so this latest run supersedes the earlier 28-draft count. Cancellation registration is still pending: no claim of cancellation migration replay is made. Parent should rerun after final registration. Only owned replay scripts/tests/report changed; no SQL migration or registry edits.

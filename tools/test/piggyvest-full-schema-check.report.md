# Full-schema probe role correction

## Frozen 183–185 combined acceptance

All three owners explicitly froze their reviewed SQL before registration. Exact hashes, independently verified before and after replay:

- `20260912183000_payment_leg_recovery.sql`: `3f62ace9a4fd9734ae3295cca3914a0a0a944b1051938b3fed6571555814668d`.
- `20260912184000_period_attribution_recovery.sql`: `77968a2684d13b90d0b31d888a7ec928ec7ff31a82194d1ca6fd7823fcb1dab9`.
- `20260912185000_reconciliation_cases_read.sql`: `5b078d9c73c9911533d7b6cbdec5eadbe7479408cb540bccbc1fdec82e847b15`.

Registration uses the same five registry/planner files listed in the 182 section below. Exact-prefix selection and changed-byte tests produced **4 RED failures → 40 GREEN** planner tests; exact manifest tests produced **3 RED failures → 69 GREEN**. Logs: `/private/tmp/piggy-183-185-plan-{red,green}.log` and `/private/tmp/piggy-183-185-registry-{red,green}.log`. Scoped Biome: **5 files clean**. The bounded planner independently verified **63 selected migrations**. Full manifest verification completed exit 0 with `WHOLE_MANIFEST_VALID` in `/private/tmp/piggy-183-185-preflight.log`; no registry gate was bypassed.

The six exact statement additions use only `piggyvest_staging_policy_writer`, with existing foreign-role and wrong-arity rejection tests. Changed paths: `apps/web/src/lib/piggyvest/postgres-statements.ts`, `apps/web/src/lib/piggyvest/postgres-statements.test.ts`, and `apps/web/src/lib/piggyvest/postgres-executor.goal-policy.test.ts`. Each two-statement batch first produced four missing-registration failures; final combined **292 tests passed**, Biome **3 files clean**. Logs: `/private/tmp/piggy-{183,184,185}-catalog-{red,green}.log`. These registrations do not confer financial completion authority.

The unchanged guarded command below then completed **exit 0**, `/private/tmp/piggy-183-185-full-schema.log`: actual Supabase PostgreSQL **170006**, enforce comparison converged, no changed components, **427 historical ordered sources** plus separately applied current-tree migrations, and completed full-schema SQL check. All three frozen hashes remained unchanged afterward. The runner reports success after owned cleanup; no independent Docker inventory claim is made. This supersedes the earlier WIP registry drift only for this frozen combined tree; parent owns broader root/targeted test reruns.

Leibniz was notified immediately after registration and reports separate standard-executor/HTTP acceptance after restart: **2 passed**, corrected wrapper exit 0, `/tmp/piggy-period-standard-http-green.log`. That is owner-reported distinct evidence, not an additional PG17 replay performed here. No provider calls, financial dispositions, migration edits, or deployment occurred.

## Frozen 182 registration and guarded replay

Fermat explicitly froze all six protected-offer migrations, 182000 through 182500, after Hooke review. SHA256 values were independently verified before registration and unchanged after replay. No migration bytes were edited.

- Changed registration paths: `apps/web/tools/db/supabase-history-replay-savings-pending-sources.ts`, `apps/web/tools/db/expected-savings-pending-sources.test-support.ts`, `apps/web/tools/db/supabase-history-replay-savings-pending-sources.test.ts`, `tools/test/piggyvest-full-local-plan.mjs`, and `tools/test/piggyvest-full-local-plan.test.mjs`.
- Planner regression: **7 RED failures → 37 GREEN tests**, including all six changed-byte rejections and exact-prefix lookalike exclusion. Logs: `/private/tmp/piggy-182-planner-red.log`, `/private/tmp/piggy-182-planner-green.log`.
- Exact manifest registration: **6 RED failures → 66 GREEN tests**. Logs: `/private/tmp/piggy-182-registry-red.log`, `/private/tmp/piggy-182-registry-green.log`. Scoped Biome: **5 files clean**.
- Bounded planner independently verified **60 selected migrations from 66 savings pending entries**. These counts are separate from the full historical replay count.
- The guarded command documented below completed **exit 0** in `/private/tmp/piggy-182-full-schema.log`: actual Supabase PostgreSQL `170006`, chronological/materialized/enforce, comparison converged with no changed components, **427 historical ordered sources** plus separately applied current-tree sources, and completed `tools/test/piggyvest-full-schema-check.sql`. Success follows the runner's owned cleanup path; no independent Docker inventory claim is made.
- Parent's earlier full-web log `/private/tmp/piggy-web-isolated-full.log` contains five failing tools/db files at the exact current-migration-registry gate. Their precise rerun after 182 registration yielded **31 passed / 2 failed across five files** in `/private/tmp/piggy-182-failed-db-subset.log`: all four materialize/GIGL files passed; the final two copied-workspace manifest cases failed the same registry gate. New unregistered `20260912184000_period_attribution_recovery.sql` appeared during this rerun, after the successful 182 replay. Current-tree copies include that WIP migration. No registry gate was weakened and no WIP file was removed or prematurely registered. A fully green current-tree rerun requires the subsequent WIP migrations to be frozen and registered first.

This accepts bounded local 182 replay only, not later 183/184 work, full-product acceptance, provider contracts, deployment, or live money behavior. Broad root checks remain parent-owned.

## Verified failure and correction

The original `/private/tmp/piggy-resumed-full-schema.log` failed SQL check ordinal 1 at shared-check line 60 with SQLSTATE `42501`: `SET LOCAL ROLE piggyvest_full_probe`. The guarded runner uses the user in its isolated Supabase database URL; it does not promise the initdb superuser authority used by the bare-PG harness.

The first correction granted the creating executor permission to assume the otherwise unprivileged probe. It passed a real PG18 non-superuser CREATEROLE regression, but **did not pass Supabase PG17**: `/private/tmp/piggy-resumed-full-schema-rerun.log` failed at wrapper line 3 without SQLSTATE. A subsequent guarded replay with bounded diagnostics for that exact SQL check confirmed `error: connection to server was lost` on `GRANT ... TO CURRENT_USER`, preserved in `/private/tmp/piggy-full-schema-role-diagnostic.log`. This was not the runner rejecting SQL through an allowlist; its sanitizer omitted a SQLSTATE because the client connection error did not contain one. No specific extension crash mechanism is claimed without server crash evidence.

The final wrapper uses `EXECUTE format('GRANT piggyvest_full_probe TO %I WITH INHERIT FALSE, SET TRUE', current_user)`. This gives the same executor the same role-switch permission using its quoted explicit role name rather than the special-role syntax. It grants no role membership or elevated attributes to the probe. The role creation and grant remain inside BEGIN/ROLLBACK. Shared ACL, RLS, denied-read, denied-RPC, disabled-integration and exact replay assertions remain unchanged.

## Evidence

- `pnpm exec node --test tools/test/piggyvest-full-schema-role.test.mjs tools/test/piggyvest-full-schema-check.test.mjs`: **4 passed**. The actual disposable PG18 regression reproduces the original `42501` as a non-superuser creator, proves explicit SET/INHERIT options and membership direction, verifies the probe remains unprivileged and rollback removes it, and demonstrates why the original bare-superuser fixture masked the problem. This remains narrower than PG17 runtime acceptance.
- Scoped Biome: **2 files clean**.
- Exact Supabase PG17 guarded replay **exit 0**, `/private/tmp/piggy-full-schema-explicit-role.log`: serverVersionNum `170006`; chronological/materialized/enforce; comparison converged, changedComponents empty; 427 ordered historical sources plus the runner's separately applied current-tree sources. The receipt records `tools/test/piggyvest-full-schema-check.sql` as the completed SQL check. This run does not claim additional public compatibility checks or type generation.
- Pre-182 count verified separately against current registry and migration bytes: **54 PiggyVest migrations selected by the bounded local planner**, out of **60 savings pending registry entries**. This is not the total full-history count. Any later 182 registration requires a new guarded replay; this passing receipt does not cover unregistered protected-offer work.
- Command from `apps/web`: `pnpm exec tsx tools/db/run-supabase-history-replay.ts --mode chronological --pending-repair-state materialized --comparison-mode enforce --sql-check tools/test/piggyvest-full-schema-check.sql`.
- The guarded runner returned success only after its owned cleanup path; the receipt contains no project/resource identifiers, so no independent post-run Docker inventory claim is made. The standalone synthetic role regression's owned directories were removed, including independently checked `/tmp/baci-piggyvest-role.YRVhGc`.

## Changed paths and boundaries

- `tools/test/piggyvest-full-schema-check.sql`
- `tools/test/piggyvest-full-schema-check.test.mjs`
- New `tools/test/piggyvest-full-schema-role.test.mjs`
- This report.

No shared private-check assertions, guarded-runner implementation, environment/config/proxy, or frozen migration bytes were changed. Both earlier failing logs remain preserved. No external service, provider, customer data or production funds were used. Parent retains broader acceptance and subsequent execution coordination.

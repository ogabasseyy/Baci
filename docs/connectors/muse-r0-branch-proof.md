# R0 Full-Schema Branch Proof — 2 October 2026

Branch `baci-connector-r0-proof` (`tzguvkfjycnrzeigigvs`), restored from
the owner-supplied schema-only snapshot (`complete-schema-only.sql`,
6,230,571 bytes, sha256 `871f0acd…5cfa4a`, verified before use; 0 data
sections). All work stayed inside the authorization window (expires
9 Oct 2026); the production parent was read-only throughout. The branch
was re-paused after the proof with test grants revoked and
`connector_gateway` returned to `NOLOGIN`.

## 1. Restore

- Filtered the dump to application schemas (`public`, `private`,
  `eventing`, `private_payment_control_plane`), 13 extension installs,
  and app-schema ACL/comments (6,429 sections kept; 1,569 managed-schema
  sections dropped). Managed schemas, event triggers, publications, and
  platform functions were left to identical platform state, verified
  present (6/6 event triggers, 6/6 support functions).
- Dropped the branch's partial-replay app objects, recreated `public`
  with byte-identical owner/ACL, and restored in 12 per-transaction
  chunks over the pooler (a single transaction was dropped
  mid-restore; chunks retry cleanly). Four dump-referenced service
  roles were pre-created with parent-identical attributes
  (`gigl_tracking_worker` login-capped but passwordless, the rest
  `NOLOGIN`); three `supabase_admin` default-privilege sections were
  excluded (unrunnable without superuser — recorded delta, see §2).
- Extension versions installed at parent-exact defaults
  (pg_cron 1.6.4, pgmq 1.5.1, postgis 3.3.7, hypopg 1.4.1,
  index_advisor 0.2.0, unaccent 1.1; pre-existing eight already matched).

## 2. Schema equivalence (parent vs branch, identical queries)

| Dimension | Result |
|---|---|
| Tables + RLS flags (246 tables) | exact match; 14 views and 8 matviews compared separately below |
| Columns + defaults | exact match |
| RLS policies (397) | exact match |
| Function bodies (1,151, incl. permission helpers) | exact match |
| Triggers, indexes (1,044), sequences, views, matviews | exact match |
| Extensions (14, versions + schemas) | exact match |
| Grants, all classes (5,918 relation entries + routines/columns/schemas/types) | exact match after §3 fix |
| Constraints | 4 textual-only diffs: nested `AND`/`OR` flattened on re-parse (dump text confirms nesting); truth tables identical |
| Default privileges | 2 explained deltas only: branch lacks 3 `supabase_admin`-in-`public` rows (unrunnable, affect only future objects created by that role); branch has 3 platform `supabase_functions` rows the parent predates |
| Realtime publication members | app side 5/5 identical; managed `messages` partitions rotate under the realtime service (1 `ONLY` parent at snapshot → 7 daily partitions hours later) — out of scope |

Method note: aggregate fingerprints must order by an explicit expression
with `COLLATE "C"` — ordinals inside `string_agg ORDER BY` are constant
no-ops (verified), and database collations differ between the projects.
Session settings (`search_path`, role visibility) were matched on both
sides; the extension hash was cross-checked against an independent local
computation.

## 3. Owner-only ACL restoration

39 relations carried explicit owner-only ACLs (`{postgres=…}`) on the
parent with no dump section (pg_dump treats them as default). The branch
restored them as `NULL` (implicit owner-only) — semantically identical,
representationally short. Applied 39 explicit `GRANT ALL … TO postgres`
statements; relation-ACL names now match 275/275 with byte-identical
grant content (§2), and the 3 legitimately NULL relations match too.

## 4. Blocker found and fixed: resolve denied every gateway call

`resolve_connector_grant_context` calls production's
`check_staff_permission`, whose guard returns false when `auth.uid()` is
NULL. The gateway (correctly) holds no user session at resolve time, so
**every** gateway read failed with `connector_grant_forbidden` on the
real schema (red proof observed on the branch). The scratch fixture's
"exact copy" predated the guard, so the suite could not catch it.

Fix (in the unreleased R0 migration): after token/status/expiry and parameter
allowlist validation and before the permission check, resolve sets transaction-local
JWT claims to the grant's linked user. Sound because the token hash
already proved possession of that grant's credential, the value derives
from the validated row (never caller input), and `EXECUTE` is granted only
to `connector_gateway`. Live permission, grant-scope and branch checks still
deny unauthorized calls; an exception rolls back the local claim changes.
The scratch replicas of `check_staff_permission`
and `get_staff_permissions` were refreshed to the production bodies
(plus an `auth.role()` shim); `has_merchant_access` and
`can_access_order` replicas verified already exact.

Red-green controls: branch red proof (`connector_grant_forbidden`
without the fix) → green (`resolve` returns full context with it);
runtime suite with faithful fixture fails 7/7 on the unfixed migration
and passes 7/7 with the fix.

## 5. Migration, regressions, RLS equivalence, harness

- R0 migration applied cleanly on the full hosted schema (role,
  membership, table + RLS, 4 RPCs, policies, trigger), recorded in the
  branch ledger. Re-applied idempotently after the §4 fix.
- SQL regression suite (`connector_grants_r0.sql`) passes on the branch
  against synthetic seed (4 users, 2 merchants, 3 branches, 1 staffer,
  4 orders; triggers suppressed for seeding only).
- RLS equivalence proof (single rolled-back transaction, assert-failing):
  owner direct reads equal gateway reads on the real `orders` table and
  real policies; branch-scoped grants narrow correctly and reject
  out-of-allowlist selectors; staff scoped grant resolves and narrows;
  suspending the staffer denies both resolve and rotate; stranger reads
  zero rows; unknown hashes, expiry, and revocation deny the next call;
  sequential claim switching (owner/stranger/owner) shows no leakage.
- Harness driven over HTTP against the branch through the pooler as
  least-privilege `connector_gateway` (temporary branch-only password,
  since cleared): 16/16 checks — issue (201), merchant-wide list of the
  3 real orders, branch-scoped list (2), own-order 200, cross-merchant
  404, foreign-merchant 403 `FORBIDDEN_SCOPE`, wrong-branch 403,
  bad-token 401, bad-body 400, inventory 501, single-use refresh
  rotation (old dead, new works), revoke with next-call denial. No
  pooler/prepared-statement issues observed.

## 6. Remaining R0 gates (unchanged)

Full-schema confirmation is complete. Still required: the real Muse
pilot (staging transport + interactive setup per the runbook), and
production-scope ADR-003 resolution before R1. R1 stays gated.

## 7. Independent re-review on 2 October

- Reran the connector Vitest scope: 11/11 files, 62/62 tests passed,
  including the 7 HTTP/disposable-PostgreSQL runtime regressions. No skip
  substituted for runtime proof.
- Compared the two refreshed permission-helper fixture bodies with the
  current production `pg_proc.prosrc` over a read-only metadata query:
  both match exactly (`check_staff_permission` MD5
  `be0bf020768b7734c2744d2f7d569fd0`; `get_staff_permissions` MD5
  `b4f2008252033f67c1dd516aae3c7ce1`).
- Confirmed the branch preview is `INACTIVE`; the historical replay status
  is still `MIGRATIONS_FAILED`. Did not resume it or repeat the hosted
  restore/RLS/16-check run during this re-review; those results are the
  recorded execution evidence in §§1–5.
- Corrected stale pending-database-proof statements in the design, ADR,
  authorization, runbook and connector draft. Current source metadata
  confirms 246 app tables plus 14 views and 8 matviews; §2 now labels the
  table count accordingly. Local document references and whitespace checks
  pass.
- Attempted the required CodeRabbit re-review with CLI 0.8.2:
  `coderabbit review --agent -t uncommitted -c /Users/mac/Baci-app/AGENTS.md`.
  It exited 1 with `rate_limit` / `Rate limit exceeded`. All three included
  reviews are used; usage-based reviews are unavailable because the selected
  organization's Git-provider account has no assigned seat. The service
  reported a 16-minute retry window. No completed CodeRabbit result was
  produced, so this gate remains open before any commit or ship.

The real read-only Muse pilot may proceed under the existing R0/staging
authorization once branch access and the filtered transport are ready.
This re-review does not open R1 or authorize production deployment.

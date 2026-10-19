# Review-only hosted savings SQL bundle

From the repository root:

```sh
pnpm --dir apps/web exec tsx ../../tools/test/hosted-savings-materialize-cli.ts --materialize-only
pnpm --dir apps/web exec tsx --test '../../tools/test/hosted-savings-materialize*.test.ts'
```

Only --materialize-only is accepted. There is no destination, connection string,
resume offset, execute, upload or deployment option. The verifier uses local Git
objects and repository files; packaging performs filesystem operations only.
No Docker, SQL client, provider, database capture or network operation is invoked.

Each success creates a new owned /tmp/hosted-savings-materialize-* directory
(0700) with SQL files, manifest.json, audit.json and SHA256SUMS (0600 files).
Failure removes only that invocation's directory. Successful bundles are retained
for parent review; do not silently overwrite, resume or delete another bundle.

Ordering is supplied by materializeSupabaseHistoryReplay(verified, chronological),
including every bootstrap source from ordinal one, followed by
applySupabaseCurrentTreeSources with a filesystem-recording apply callback. The
existing applier alone chooses replacements/supersessions. It executes no SQL.
The manifest preserves all source inputs as well as actual emitted order and
output hashes, including any existing verified transforms. It does not invent a
new migration registry, substitute a production dump or fabricate applied ledger
entries. Source SQL includes repository-owned seed/backfill logic; "materialize"
does not mean DDL-only or effect-free.

The SHA256SUMS file covers every emitted SQL file plus audit.json and manifest.json.
The returned manifest SHA binds ordering, inputs, output hashes and the audit hash.
Use manifest.entries order for review; lexicographic filename sorting is incorrect
for non-zero-padded ordinals. No apply script is supplied.

The audit is a redacted text scan, not a parser or security proof. It reports file,
line and category without echoing SQL literals. Comments and stored function
bodies may match; quoted identifiers, dynamic SQL and indirect calls may escape
the scan. All flagged external effects and prerequisites require human review.

## Current receipt — 2026-09-14

Bundle: /tmp/hosted-savings-materialize-kvPwBZ

Manifest SHA-256:
0546896a24a17138b207da860d3b97d4baa35bdca4516645605043f12c1fb90f

1,177 verified source inputs produce 1,165 ordered SQL files (7,335,918 bytes).
Twelve historical bodies are omitted by the existing replacement/supersession
engine, not by a resume offset. First file: sql/1-20260418000000_baseline.sql.
Last file: sql/1165-20260913140000_customer_savings_canonical_isolation.sql.
All 1,167 checksum entries (SQL + audit + manifest) verified locally after writing.
Seven focused tests passed; scoped Biome and root lint/typecheck passed.
No SQL execution or VPS inspection occurred. VPS service health/version details
are parent-provided, not verified by this packaging task.

## Blockers before upload/apply

1. Managed-schema prerequisites: healthy Auth/PostgREST alone does not prove the
   Supabase database bootstrap contract. Baseline line 6 requires uuid-ossp,
   pgcrypto, pg_trgm, vector and pg_net; line 12942 onward references auth.users;
   lines 17400 onward manipulate storage.buckets, storage.objects and
   storage.foldername. Verify real Auth functions/roles, Storage schema/helpers,
   Realtime/publication and extension objects against the bundle. Do not create
   dummy substitutes or overwrite existing Auth identities to pass replay.
2. Migration ledger: 20260907111036_repair_sales_exclusion_wallet_version_collision.sql
   line 6 queries supabase_migrations.schema_migrations. A plain PostgreSQL stack
   may lack this table. The package intentionally does not mark migrations as
   applied. Parent must review faithful local ledger bootstrapping/accounting;
   replaying SQL files is not equivalent to Supabase CLI's bootstrap lifecycle.
3. Scheduled/external effects: the audit has 36 scheduling matches and 43 external
   effect matches. 20260801090000_harden_product_description_provenance_retention.sql:167
   and 20260812220000_cleanup_legacy_expense_receipt_candidates.sql:52 schedule
   mutating cleanup jobs when cron exists. 20260805151320_schedule_scheduled_admin_notification_worker.sql:14
   defines an HTTP dispatch using Vault secrets; line 52 schedules it when its
   prerequisites exist. Keep outbound access and background execution contained
   before applying; empty business data alone does not establish containment.
   No production Vault values should be present, imported or generated here.
4. Role/ownership conflicts: 20260801140000_payment_ingress_contract_companion.sql:7
   deliberately rejects a pre-existing payment_control_plane role. It creates a
   NOLOGIN control-plane role and changes ACLs. Baseline ownership and later
   grants expect Supabase roles and privileged DDL access. Review the isolated
   cluster's roles/owners rather than stripping guards or inheriting production
   credentials. Auth may create users/triggers while migrations are changing
   dependent objects; pause application activity for the separately approved
   rehearsal and preserve its existing Auth schema/data.
5. Server compatibility is unproven: parent reports postgres 17.6.1.136, whereas
   the local CLI rehearsal pins image 17.6.1.106 and server_version_num 170006.
   This materializer neither connects to that server nor relaxes the local
   runner guard. Extension/preload/schema differences need a reviewed preflight.
6. Canonical runtime remains disabled and unconnected: binding migration requires
   socket login piggyvest_staging_policy_writer in piggyvest_local; isolation
   creation requires savings_local_plan_writer in postgres with an enabled scope.
   Registration and packaging grant none of those capabilities. Preserve those
   guards; reconciling them is a separate reviewed design task.

The scan additionally reports 4,236 role/ACL matches, 1,742 managed-schema
references, 2,129 data-mutation matches, 13 extension matches and 95 secret
references. No psql backslash commands were matched. These are textual counts,
not numbers of executed effects or a claim that the SQL contains no secrets.

Parent review is required before upload or apply. This bundle is not a passed
fresh replay, deploy artifact, or authorization to mutate the VPS.

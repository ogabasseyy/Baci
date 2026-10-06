# Reviewed isolated schema installer

No remote execution has been performed. Run only on the owned Docker host after
parent review, from this repository with its existing pnpm dependencies. This is
not a production migration command and accepts no DSN, SSH destination, or resume.

## Required receipt

Create a private JSON file after reviewing the bundle and immutable Docker identity:
`version: 1`, `project: "baci-isolated-savings"`, exact Compose `service`, full
64-character `containerId`, `imageId` including `sha256:`, `dockerSocket`
(`/var/run/docker.sock` on VPS), verified `postgresSocket` (`/var/run/postgresql`
or `/tmp`), `database: "postgres"`, `serverVersion: 170006`, `manifestSha256`,
and explicit true `parentReviewed`, `maintenance`, `noApplicationActivity`,
`noExternalCredentials`. Unknown properties are rejected. No credentials belong here.

`allowedNewMemberships` defaults to empty. Every original membership must remain,
including grantor/admin/inherit/set options. Reviewed new edges require new NOLOGIN,
non-superuser, non-BYPASSRLS, non-CREATEROLE, non-CREATEDB, non-replication endpoints.
The only existing-principal exception is explicitly allowlisting
`{"role":"repair_pickup_receiver","member":"authenticator"}`: new restricted
repair role, grantor postgres or preexisting unchanged SUPERUSER supabase_admin at OID 10,
admin false, inherit false, set true. PostgreSQL records superuser membership grants
under the bootstrap superuser; on the reviewed image this is supabase_admin. This corresponds
to recorded role OID evidence, not a name-only exception. Older snapshots without
OID evidence cannot authorize this additional grantor. The contract corresponds
to migrations 20260903101500 and 20260904110000. Reversed, inheritable, elevated,
unlisted, or other existing-principal edges fail. The reviewed SQL restricts the
capability RPCs by merchant-bound server JWT claims. This does not authorize
enabling that application route. Managed role attributes/Auth data fingerprints
remain unchanged. If the target's default membership options differ, stop for review.

Reviewed bundle: `/tmp/hosted-savings-materialize-kvPwBZ`, 1165 SQL files;
manifest SHA256 `0546896a24a17138b207da860d3b97d4baa35bdca4516645605043f12c1fb90f`.
Verify the hash again after any parent-approved transfer. Commands on target host:

```sh
pnpm --dir apps/web exec tsx ../../tools/test/hosted-savings-install-cli.ts --preflight --receipt /absolute/reviewed-receipt.json --bundle /absolute/reviewed-bundle
pnpm --dir apps/web exec tsx ../../tools/test/hosted-savings-install-cli.ts --install-reviewed --receipt /absolute/reviewed-receipt.json --bundle /absolute/reviewed-bundle
```

Preflight performs guarded local metadata/fingerprint SQL (including temporary
snapshot tables), but no persistent schema installation. Both modes verify all
bundle bytes first, immutable container/image/Compose identity, internal networks,
no published ports/privilege, stopped or paused peers, and no other DB clients.

## Prerequisites and current blockers

Require real Auth/Storage/Realtime/graphql schemas, supabase_realtime publication,
installed uuid-ossp/pgcrypto/pg_trgm/vector/pg_net/pg_cron, required managed roles,
and empty Vault. Parent reports official Storage v1.74.0: **70 migration rows,
maximum ID 69**, empty data and scoped NOLOGIN initializer; not independently
queried by this installer task. Publication reportedly exists. Realtime messages,
graphql and Vault are still pending according to latest parent metadata.

Cron must have `cron.launch_active_jobs=off`; pg_net.database_name must name no
existing database. All enabled event triggers are rejected. Official
issue_pg_cron_access/issue_pg_net_access therefore remain blockers until the
prerequisite owner provides reviewed scoped containment. Installer does not alter
these settings or triggers. Maintenance remains mandatory after installation.

Scheduling SQL creates hourly cleanup and one-second quiz-clock jobs. Stored HTTP
functions reference Vault project URL/service-role material. An empty Vault alone
is not adequate isolation: background execution, event triggers and network
boundaries remain guarded. Schema replay does not prove safe application enablement.

## Accounting and failure semantics

Uses the existing materializer ordering and applySupabaseReplaySql error boundary.
First 125 bootstrap version/name rows are recorded only after successful SQL,
matching the existing harness bootstrap ledger. Later historical/current files
are not falsely marked in the Supabase ledger. An independent private RLS journal
records every successful ordinal/source/hash. Ledger statements contain one exact
full SQL body per entry, not the CLI's split-statement array representation.

First error stops, with redacted phase/ordinal/SQLSTATE and a private receipt under
`/tmp/hosted-savings-install-*`. SQL can contain its own commits: earlier successes
and partial failed-file effects remain. No global rollback, implicit skip, resume,
cleanup, service restart, or Auth reset occurs. Existing installer/ledger namespaces
block reruns. Parent must inspect evidence and explicitly own any disposal/rebuild.
Auth fingerprints are compared after each file; this detects but cannot undo drift.

## Local tests (no database execution)

```sh
pnpm --dir apps/web exec tsx --test '../../tools/test/hosted-savings-install*.test.ts'
pnpm exec tsc -p tools/test/hosted-savings-install-tsconfig.json
pnpm exec biome check tools/test/hosted-savings-install*.ts tools/test/hosted-savings-install-tsconfig.json
```

Fresh full replay remains unproven; local disk headroom is insufficient. Never
interpret mock tests or package verification as a successful VPS schema replay.

## First retained failure and owned recovery

Parent reports receipt `/tmp/hosted-savings-install-0ut5Dk/receipt.json`:
migration ordinal 1, completed 0, claimed true. This does NOT mean zero writes.
The baseline contains nontransactional DDL and sets statement/lock timeout to zero;
the Docker process timeout still applies. Parent identified the boundary immediately
after validate_order_number: baseline line 7307 creates admin_query_performance,
referencing extensions.pg_stat_statements at line 7318. Missing extension is the
current hypothesis, not a recovered SQLSTATE. Preflight now requires the genuine
extension-owned relation and its referenced columns (P7110/P7111); no fake view.

The original Docker error used SQLSTATE=, which the shared applier rejects. The
installer now captures only allowlisted diagnostic fields before that boundary,
adapts to its existing `docker failed: non-zero-exit (line=N,sqlstate=CODE)` format,
and retains SQLSTATE/line/exit code/signal in the redacted receipt. psql reads via
`-f -` to supply input line numbers. No query/error-detail payload is emitted.
Old missing diagnostics cannot be reconstructed; do not replay to obtain them.

Keep the parent SSH lock and maintenance. Retain failed container/volume, immutable
identity, bundle hash and receipt for metadata-only inspection. Do not drop public
CASCADE, delete the claim/journal, seed ledger rows, skip baseline, or resume.
Parent-authorized recovery is a separate fresh owned database/container+volume
provisioned through the reviewed prerequisite procedure (including genuine
pg_stat_statements in extensions). Preserve the original failed instance and all
Auth/Storage state; do not copy production or silently discard existing users.
Reverify original managed fingerprints independently. Require a new container
receipt, parent review, full preflight, then replay from ordinal 1. The installer
does not perform disposal, provisioning, credential copying or automatic recovery.

Container recreation does not establish freshness. The read-only recovery planner
accepts a new reviewed current receipt only with explicit parent-reviewed lineage
when the failed receipt container/image differs. Metadata must bind full prior and
current container/image IDs, equal prior/current PostgreSQL system identifiers,
equal volume-identity hashes, and hashes of independently retained prior/current
identity evidence. Volume identity evidence must identify the Docker daemon and
the original owned PGDATA volume/mount, not merely a reused Compose volume name.
Keep identifiers as strings (the PostgreSQL identifier exceeds JS safe integers).
Missing old evidence, prefix-only IDs, cluster or volume mismatch are rejections;
the planner cannot infer lineage from a healthy container or current identifier.
This is a parent attestation, not live verification or reset authorization.
Original managed state remains on the preserved volume/current container even
when Compose has already removed the earlier container. Exact empty journal and
ledger evidence alone does not establish an exact partial baseline closure.

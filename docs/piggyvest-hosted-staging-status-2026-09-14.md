# Hosted staging status — 14 September 2026

## Verified on the VPS

- Dedicated `baci-isolated-savings` Compose resources exist. PostgreSQL, Auth,
  PostgREST and the internal mail sink report healthy. This is infrastructure
  health, not a savings integration pass.
- Independent staging database-role passwords and a JWT secret were generated
  on the VPS, retained in a private mode-0600 runtime file, and not displayed.
- Owner installed the root-owned staging firewall helper and systemd unit.
  Unit status is active/enabled with successful exit. Containers do not have
  automatic restart enabled pending a firewall-gated staging supervisor.
- Networks remain internal. No database or mail ports are published. Public
  signup is disabled, and no external mail or provider integration is configured.
- Docker 29.6.1 retains requested loopback port bindings but does not publish
  them on this internal-only network. Do not assume loopback 15439/15430 works.
- Direct private routing from the host succeeds: Auth health and REST root
  both return HTTP 200. Container addresses are transient, not deployment constants.
- Synthetic temporary HTTP listeners on both bridge gateways were unreachable
  from Auth with bounded probes. Both probes exited nonzero and both listeners
  were closed. This is scoped container-to-host evidence, not a complete security audit.

## Corrections made

Auth's first migration could not replace image-provided `auth.uid` owned by
postgres. Bootstrap now assigns the auth schema and three existing auth helper
functions to the dedicated Auth role, without superuser grants. The actual Auth
service subsequently became healthy. Optional unused service roles are disabled
only when present. No existing repository migration was modified for these fixes.

## Not ready yet

Baci schema installation/replay, synthetic customer seeding, public TLS/gateway,
DNS, staging app deployment, mobile hosted-mode wiring, startup/restart supervision,
backup/restore and end-to-end savings validation remain outstanding. No production
database or customer data was copied. The Vercel registration endpoint has not
been replaced, and provider financial processing has not been enabled.

Current work prepares exact-inventory-validated private routing and a hashed
schema materialization bundle. Neither preparation authorizes accepting financial
events or reporting that the customer savings journey is live.

## Private gateway and schema follow-up

An inventory-bound Nginx configuration passed actual VPS parsing and an ephemeral
unprivileged loopback test on port 15440. Explicit-host HTTP checks returned:
`/auth/v1/user` 401, `/auth/v1/admin/users` 403, `/auth/v1/signup` 403,
`/unsupported` 404, and `/rest/v1/products` 404 (the Baci schema is absent).
The test Nginx process was stopped afterward; no system Nginx configuration was
installed or reloaded. The initial Node fetch readiness probe did not establish
readiness; the successful checks used curl with an explicit Host header.

Fresh firewall tests first confirmed their temporary host listeners were
reachable from the host, then confirmed container requests to both were blocked.
The routing receipt binds container/network/endpoint identities and expires;
it is not a persistent public deployment configuration.

The existing schema engine materialized 1,165 ordered SQL files (7.34 MB) locally;
all 1,167 manifest/checksum entries verified. No SQL bundle was applied to the VPS.
Metadata checks on the private server report version 170006, auth.users present,
but storage.objects, storage.buckets and supabase_migrations.schema_migrations
absent. Installed extensions are pgcrypto, plpgsql and uuid-ossp. Official managed
schema/extension prerequisites, ledger accounting, background-job containment and
canonical runtime guard compatibility must be resolved before installation.

## Background worker containment

Fresh inspection found pg_cron and pg_net already preloaded by the official image.
Before any Baci migration execution, the owned staging Auth and REST containers
were stopped for maintenance. Only the isolated staging database was restarted
after persistently disabling cron job launches and directing pg_net to the
nonexistent `baci_disabled_background` database. Post-restart checks confirmed
`cron.launch_active_jobs=off`, the expected pg_net target, no pending restart,
no matching target database and no pg_net worker. The database is healthy.
Auth and REST remain intentionally stopped; earlier health results are historical.

The Compose template now enforces both settings at startup. Its new regression
failed before the change and passed afterward: 12 tests passed, two local Docker
Compose checks skipped. Root lint and typecheck passed with cached results;
explicit Biome checks of both changed files passed. This does not establish a
successful schema replay or hosted customer flow.

## Official Storage schema executed

The official `supabase/storage-api:v1.74.0` amd64 image was pulled on the VPS,
digest `sha256:f1546fac6d1c7e345428ac904bfaa7be7cecd50a1f549fe1cf38c628a7b15c85`.
Its packaged migration CLI was verified, then run once on the existing private
database network with a separate temporary, non-superuser initializer credential.
The worker exited 0. Post-migration checks passed: 70 migration ledger rows,
maximum ID 69, expected final migration, empty buckets/objects, RLS enabled,
and initializer NOLOGIN with no superuser, create-role, create-database or
bypass-RLS capability. Password removal and session termination completed.

This resolves the missing official Storage tables, not the Baci application
schema. No Storage HTTP service, public port, provider call or customer data was
introduced. Auth/REST remain stopped for the next private maintenance step.

## Managed prerequisites and first application replay

Twelve pinned official sources and their SQL projections verified. The reviewed
managed-prerequisite transaction exited 0 and preserved Auth/Storage state.
It installed actual packaged extensions, the official GraphQL wrapper and the
schema-only Realtime prerequisite; operational Realtime remains unsupported.
Only the two exact-source-verified official extension triggers were disabled.

The checksummed application bundle transferred and installer preflight passed.
The first full replay then stopped at ordinal 1, before any successful journal or
Supabase ledger entries. Retained metadata shows the baseline reached its public
functions and orders table, but its next performance view requires the absent
`extensions.pg_stat_statements` relation. The extension is available in the pinned
image but was missing from the prerequisite list. No migration was skipped or
resumed, and no partial schema was deleted. The failed receipt is retained on the
VPS at `/tmp/hosted-savings-install-0ut5Dk/receipt.json`.

Query-statistics collection is now disabled in the Compose startup command and
verified on the recreated owned database. Persistent volumes were preserved.
The query-statistics regression failed before the fix and passes afterward;
13 Compose tests pass, two local parser tests skip; root lint/typecheck pass.
Extension correction and reviewed first-file recovery remain in progress.

## Recovery evidence and local disk limit

The failed isolated database was backed up privately on the VPS before any reset.
The 567,963-byte database archive passed `pg_restore --list`; a separate 0600
globals backup is retained. This is archive validation, not a restore rehearsal.
Auth users and orders are both empty. No in-place reset has been executed.

The Mac reached ENOSPC. Only this task's temporary, already-transferred duplicate
archive, executable and materialized SQL copies were removed. The local
materialization folder now retains its baseline and metadata only; the complete,
checksum-verified bundle remains on the VPS in `schema-reviewed-0546896a`.
No repository source, user files or unrelated caches were deleted. Four new
colocated extension-repair tests and their targeted Biome check pass; the latest
pnpm-driven checks are blocked by disk I/O errors and must be rerun.

## Fresh-volume replay and current verification

In-place recovery was abandoned without committing a reset. The original failed
volumes and private backups remain retained. Fresh `db-data-replay2` and
`db-config-replay2` volumes received official Auth and Storage migrations and
the corrected managed prerequisites, including query-statistics support with
collection disabled. Auth and REST stayed stopped during application replay.

A cleanly stopped, pre-application checkpoint of both fresh volumes was copied
successfully and retained separately. Its receipt is
`/home/bassey/baci-isolated-savings/replay2-clean-checkpoint.json`; this is a cold
copy, not yet a demonstrated restore.

The second application replay completed 986 entries, then stopped after ordinal
987 at the Auth-preservation check. The retained receipt is
`/tmp/hosted-savings-install-0DIM2F/receipt.json`. The reviewed repair capability
membership has grantor `supabase_admin`, whereas the installer expected
`postgres`; its admin/inherit/set options are respectively false/false/true.
The guard remains closed while this exact managed-role difference is reviewed.
No migration was skipped and no partial replay was resumed.

The latest root lint and typecheck commands both exited 0 using Turbo cache;
lint warnings remain. Mobile hosted-mode startup now fails closed before app
auth or telemetry initialization; this does not enable the hosted journey.
Public Auth DNS/TLS, hosted app deployment and financial end-to-end validation
are still unverified.

## Guard correction and checkpoint restore

The pinned database identifies `supabase_admin` as bootstrap superuser OID 10.
PostgreSQL records superuser role-membership grants under that identity, as
documented in its [GRANT reference](https://www.postgresql.org/docs/17/sql-grant.html).
The installer now accepts that exact preexisting, unchanged bootstrap principal
only for the reviewed repair capability edge; membership options and protected
Auth checks remain enforced. Nineteen parent-run focused guard/install tests pass.

The first checkpoint-clone attempt stopped before creating destination volumes
because its control-data executable path did not match the pinned image. That
path was corrected with regression coverage; eight synthetic helper tests pass.
The reviewed retry cloned into new `db-data-replay3` and `db-config-replay3`
volumes. Original, replay2 and clean-checkpoint volumes remain retained.

The restored database started healthy. Direct checks confirmed the checkpoint's
system identifier, zero Auth users, and no application-install journal or ledger.
This demonstrates restoration of the pre-application checkpoint, not restoration
of the earlier database dump or completion of application testing.

The corrected full replay is running on container
`31199f9ffcd7fb4c5f2feccc71dc8a4827d2f2d84d0d2bb058a3adbcf46d963a`.
Its installer SHA256 is
`84d9ede824beb3338e4b87aa907cc31b39919fdf7b82813386bbdf471a8bc852`.
No successful replay result is claimed yet. A subsequent root lint run caught a
formatting error during concurrent mobile work; final checks must run after those
edits finish.

The replay3 attempt stopped before claiming a journal: PostgreSQL serializes OID
values as JSON strings, but the new guard expects a number. The snapshot query
needs an explicit numeric cast; no application migration ran on replay3.

After the mobile edits froze, the agent reported 155 focused tests plus three
bootstrap tests passing and root lint/typecheck exiting 0. Parent verified the
bootstrap tests separately. Hosted storage and telemetry isolation are implemented
as groundwork, with startup still disabled until the gateway/profile is wired.

Parent attempted the full root test suite. It reported failures in unrelated
Cloudflare process-isolation tests and was stopped when local disk space fell to
249 MiB during concurrent test activity. Only this task's test-process tree was
terminated. Full-suite success is not established, regardless of the interrupted
wrapper's exit status; the retained log is
`/private/tmp/baci-staging-full-tests-0914.log` on the Mac.

The OID snapshot now casts to `bigint`, preserving strict numeric validation.
Thirteen focused agent-run tests pass. The rebundled installer hash is
`9119a77a9acb43d37a35b978a1b8fc49023deea24a12dc69e7300b8cb170f0ec`;
local and VPS hashes match. Fresh VPS preflight passed with no journal claim
(`/tmp/hosted-savings-install-GagpO2/receipt.json`), and the full application replay
was started again from the still-pristine replay3 database.

## Complete isolated schema replay

The corrected installer exited 0 with `status=installed`, `completed=1165`,
verified journal and bootstrap ledger, and preserved Auth state. Receipt:
`/tmp/hosted-savings-install-EVn0GU/receipt.json` on the VPS. The manifest hash and
replay3 container identity match the reviewed values above. This establishes
complete isolated schema replay, not public deployment or provider validation.

The draft-request idempotency key now uses the shared isolated storage prefix
exactly once. The agent reported two regression failures before the fix and
34 focused tests passing afterward. Hosted bootstrap remains disabled.

After replay completion, the existing private Auth and REST services were started.
Docker reports database, Auth, REST and Mailpit healthy. Host-private requests to
Auth `/health` and the REST root both returned HTTP 200. No service publishes a
host port. This is private service health only; no public gateway, customer login,
saved-plan journey or PiggyVest financial event has been validated by these checks.

The latest root lint and typecheck run exited 0 after the mobile draft-key change;
typecheck reports six successful tasks. Turbo also reported disk-space errors
while flushing logs, so cached/log artifacts may be incomplete. Local free space
remains critically low. The interrupted full-suite run's verified temporary clone
`/private/tmp/baci-replay-verifier-WhZ3Ay` was removed after checking its origin was
this exact worktree and its creation time matched the run. No unrelated worktree,
dependencies, production data or retained database volume was deleted.

Code review identified a remaining hosted-draft authorization prerequisite:
the existing draft-storage migration permits only `local_test`. A distinct,
disabled-by-default hosted binding and visibility authorization are needed;
hosted deployment must not masquerade as local tests. Canonical activation remains
behind the existing local-writer/socket restriction and is not enabled by seeding
catalogue fixtures or by the successful schema replay.

A guarded catalogue fixture seeder is now prepared in
`tools/test/hosted-savings-fixture.ts`, with usage and boundaries in its adjacent
README. Parent ran its seven colocated tests and targeted Biome successfully.
It defaults to rollback, requires exact installed journal/cluster identity and
two officially provisioned synthetic Auth accounts, rejects collisions, and keeps
all feature flags false. It has not been run against PostgreSQL and no accounts
or catalogue fixtures were created in this step. This is tooling readiness only.

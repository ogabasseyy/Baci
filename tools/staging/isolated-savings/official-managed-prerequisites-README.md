# Official non-Storage schema prerequisites — PG170006

This is a **schema-only installer prerequisite**, not operational Realtime or GraphQL, a Baci migration replay, or deployment approval. `launchReady` and `realtimeOperational` remain false. No service is started. No provider credentials, Vault secrets, cron jobs, network requests or production data are installed.

## Parent handoff / execution

Parent owns compose and database lifecycle. Stop Auth/REST and other database clients. Use the reviewed dedicated `supabase/postgres:17.6.1.136` container with its persistent volumes. Both GUCs must come from **command line** startup arguments: `cron.launch_active_jobs=off` and `pg_net.database_name=baci_disabled_background`; the latter database must not exist. File-only or session overrides are rejected. No ALTER SYSTEM, reload, restart or session substitute is performed here.

Parent supplied current container ID `d1415bfab2fe6c830132e59cfea013acb3d612ce63736259fcf712e806ce8013` and PostgreSQL system identifier `7685172624138473505`. These are distinct identifiers. Recapture both if the target changes. This agent did not connect to the VPS.

From the repository root, render locally for review:

```sh
node tools/staging/isolated-savings/official-managed-prerequisites-cli.mjs \
  --sql --system-identifier 7685172624138473505 --schema-only-reviewed
```

For the parent's separately authorized rehearsal, pipe that output into **that exact container's** `psql -X --no-password -v ON_ERROR_STOP=1 -h /var/run/postgresql -U postgres -d postgres` using `docker exec -i`. Preserve both pipeline exit statuses (`set -o pipefail`). No credentials are required in arguments or environment. Alternatively, where Node and psql run alongside the isolated cluster, use `--apply` with the same identity/review flags and `--socket /var/run/postgresql`. TCP URLs/hosts and ambient libpq configuration are not accepted by the runner.

All DDL and postconditions are inside one transaction. A failed guard or verification rolls back extension installs and trigger disables. A second successful installation attempt is rejected rather than silently adopting existing objects. The renderer emits executable SQL; do not run individual component SQL files independently.

## Exact dependency and source boundary

The JSON source manifest records immutable upstream commits, URLs and SHA-256 of complete official source files, plus vendored SQL hashes. The image digest is `sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00`. Offline asset checks precede SQL rendering. The provenance verifier separately fetches pinned public sources and proves the projections; it never connects to PostgreSQL.

- **Auth**: existing GoTrue `auth.jwt()`, `auth.uid()` and `auth.role()` are required, not recreated. The Auth v2.196.0 source is retained as provenance/test material only. Existing Auth and Storage table data, function bodies/owners/ACLs, relation RLS/ACLs, existing roles and memberships are fingerprinted before and after. No Storage migrations or role activation occurs.
- **Extensions**: install the image's official `uuid-ossp`, `pgcrypto`, `pg_trgm`, `vector`, `pg_net`, `pg_cron`, `supabase_vault` packages. Existing extension instances are preserved. Vault 0.2.8 is rejected because it needs legacy pgsodium prerequisites. The tested image defaults are uuid-ossp 1.1, pgcrypto 1.3, pg_trgm 1.6, vector 0.8.2, pg_net 0.20.3, pg_cron 1.6.4 and Vault 0.3.1. Final Vault, cron jobs and HTTP request queue must be empty.
- **Triggers**: only enabled `issue_pg_cron_access` and `issue_pg_net_access` with exact pinned official `post-setup.sql` function body hashes, event/tag, function name/schema/language/return type, ownership and security settings may be disabled. Unknown or altered enabled triggers fail closed. These two remain disabled after commit to satisfy the parent installer's reviewed maintenance gate. No trigger is silently skipped or automatically re-enabled. The parent independently confirmed these exact live hashes.
- **GraphQL**: use the byte-exact disabled `graphql_public.graphql(text,text,jsonb,jsonb)` entrypoint from the PG17 image's official schema snapshot. It returns the official explicit GraphQL error. `pg_graphql` is deliberately not installed: it is not in the parent installer's extension requirements and would introduce cache-maintenance event triggers. There is no invented GraphQL implementation.
- **Realtime**: the SQL-only projection uses Realtime v2.86.3's official partitioned table DDL and SQL `topic()` definition. The only table transformations are renaming the fresh `messages_new` definition to `messages`, and folding the official later Ecto UUID migration into its ID definition. The replay index is the SQL equivalent of the pinned Ecto index migration. Owner, SELECT/INSERT/UPDATE grants and RLS/default-deny behavior are preserved. No `send`, broadcast wrapper, partition scheduler, replication slot, tenant seed or service is installed. Direct broadcast calls fail with undefined-function; inserts fail without partitions. No silent-success `send` stub is supplied.
- **Publication**: preserve an existing empty `supabase_realtime` publication or create the official empty publication with insert/update/delete/truncate publish options. Refuse an all-tables or populated publication.

`official-managed-prerequisites-dependencies.json` pins every active top-level Baci migration with a Realtime reference: the historical shipment migration, its append-only repair, quiz wakeup v2 and its access-policy update. The closure test rejects new or changed references. These require `messages` and `topic()` for DDL; all `send` references are runtime PL/pgSQL calls guarded by `to_regprocedure`. GIGL raises unavailable when `send` is absent. The existing quiz emitter intentionally returns when it is absent; **that existing behavior is not delivery confirmation**. Parent must keep broadcast-dependent product flows disabled until a separate operational Realtime task installs and verifies the official migration/service lifecycle. This bootstrap cannot certify those flows.

Executing the full Realtime tenant migrator would install subscription/WAL machinery and require the tenant/service lifecycle, beyond this non-Storage prerequisite. This explicitly reviewed projection avoids that lifecycle and must not be recorded as an upstream Realtime migration ledger. The PostgreSQL tests validate the real projected schema and failure behavior, not a mock function implementation.

## Validation

```sh
node --test tools/staging/isolated-savings/official-managed-prerequisites*.test.mjs
BACI_MANAGED_PREREQUISITES_TEST=1 \
BACI_MANAGED_PREREQUISITES_DOCKER_SOCKET=/Users/mac/.colima/default/docker.sock \
node --test tools/staging/isolated-savings/official-managed-prerequisites*.test.mjs
```

Integration tests require the pinned image already pulled, create a disposable network-none local container with no published ports and local-socket trust auth, then remove it. They never pull images, use a remote Docker endpoint or touch the VPS. On Linux the socket defaults to `/var/run/docker.sock`. The test-only fixture Auth schema comes from the pinned official image init script; a synthetic Storage preservation table exercises snapshot protection without pretending to supply Storage.

Sources: [Postgres 17.6.1.136](https://github.com/supabase/postgres/tree/d156ba65c14694c12cc5e782bc15b9b8ed2d1376), [Auth v2.196.0](https://github.com/supabase/auth/tree/0204331ca41a5b49f076b6fa3dc6c0d20b996590), [Realtime v2.86.3](https://github.com/supabase/realtime/tree/4ab775b8fc5dd60020ebd3bf62d6d91debf69dea). The manifest supplies exact per-file links and hashes. Current Supabase changelog research confirmed that the hosted-platform extension-version change explicitly does not affect self-hosting; gateway changes do not apply to this SQL-only scope.

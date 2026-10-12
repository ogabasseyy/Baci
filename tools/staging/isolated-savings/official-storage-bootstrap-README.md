# Official Storage schema bootstrap — prepared locally, not run

This is a one-shot migration worker, not a Storage HTTP deployment. It executes
the migration CLI **inside** `supabase/storage-api:v1.74.0`, using the SQL shipped
in that image. No copied/modified migration SQL, fake tables, production data,
new API routes, host ports or application changes are involved.

## Verified upstream contract

- [Pinned self-hosted v0.8.1 Compose](https://github.com/supabase/supabase/blob/8c7a4d9dbbaf8b552893822e89d7bf06f33f9220/docker/docker-compose.yml)
  pairs `supabase/postgres:17.6.1.136` with `supabase/storage-api:v1.74.0`.
- Storage tag resolves to commit `01c95148a981a88b5f7e9014571a2926567b51e3`.
  Its [Dockerfile](https://github.com/supabase/storage/blob/01c95148a981a88b5f7e9014571a2926567b51e3/Dockerfile)
  copies `migrations/` and compiled `dist/` into `/app`; default command starts
  `dist/start/server.js`. We override only the command to the compiled official
  [migrate-call entrypoint](https://github.com/supabase/storage/blob/01c95148a981a88b5f7e9014571a2926567b51e3/src/scripts/migrate-call.ts).
  [build.js](https://github.com/supabase/storage/blob/01c95148a981a88b5f7e9014571a2926567b51e3/build.js)
  compiles all `src/**/*.ts`, including that CLI, to `dist/`.
- The [migration runner](https://github.com/supabase/storage/blob/01c95148a981a88b5f7e9014571a2926567b51e3/src/internal/database/migrations/migrate.ts)
  runs tenant SQL under `storage`, owns migration locking/ordering/checksums, and
  explicitly sets `storage.install_roles` from `DB_INSTALL_ROLES`. We set it false
  and disable hash refresh. Do not run individual SQL files with psql instead.
- [Migration 0002](https://github.com/supabase/storage/blob/01c95148a981a88b5f7e9014571a2926567b51e3/migrations/tenant/0002-storage-schema.sql)
  skips role creation, membership grants and role-changing blocks when that setting
  is false. This avoids its legacy `GRANT postgres TO authenticator` path. All
  actual table/function/index migrations still execute. Final pinned migration:
  `validate-bucket-lifecycle-constraints` (69).

Compatibility is supported by the official paired release, not by a local database
replay. Parent must verify registry digest/architecture and actual worker exit plus
SQL assertions. No images or databases have been executed by this task.

## Input and local commands

```sh
node --test tools/staging/isolated-savings/official-storage-bootstrap*.test.mjs
node tools/staging/isolated-savings/official-storage-bootstrap-cli.mjs --template < storage-evidence.json
```

Input is a sanitized, parent-reviewed projection (no Env/password fields):

```json
{
  "observedAt": "<fresh ISO timestamp>",
  "reviewed": true,
  "db": {
    "id": "<verified full container ID>",
    "image": "supabase/postgres:17.6.1.136",
    "project": "baci-isolated-savings",
    "service": "db",
    "healthy": true,
    "networkId": "<verified full database network ID>"
  },
  "network": {
    "id": "<same verified full database network ID>",
    "name": "baci-isolated-savings_database",
    "project": "baci-isolated-savings",
    "internal": true,
    "bridge": "baci-stg-db"
  }
}
```

Evidence expires after five minutes. Save the generated standalone Compose JSON
outside existing project config. `external:true` means **reuse the existing named
Docker network**, not public connectivity: its inspected `Internal` must be true.
Hold the existing parent lifecycle lock, recapture IDs before execution, verify
the `db` DNS alias belongs exclusively to that container, and refuse existing
`storage-bootstrap` containers. The generator cannot verify a live engine or keep
network names from being reassigned after verification.

## Exact parent-reviewed execution sequence

1. Close staging ingress and retain the four private services. Confirm the existing
   host firewall and database bridge ownership. Review the new SQL and official
   image. Obtain a fresh dedicated `ISOLATED_STORAGE_DB_PASSWORD`: independently
   generated 64 lowercase hex characters, distinct from all existing DB passwords
   and JWT secret. No secret generation/read was performed here. Do not change
   existing `.env` files, role guards, core Compose or repository migrations.
2. Using the verified DB container's existing authorized admin psql path, execute
   `official-storage-bootstrap-prepare.sql`. For a parent shell holding the new
   variable, Docker's `--env ISOLATED_STORAGE_DB_PASSWORD` passes its value without
   putting the value in the command arguments. Stream the SQL with `psql -X -f -`
   and stdin; never echo the password or use psql `--echo-all`/`--echo-queries`.
   The psql script uses `\getenv` and SQL literal quoting. It rejects non-PG17.6,
   existing initializer roles and nonempty Storage schemas before committing.
3. Preparation creates `baci_storage_initializer`, a temporary LOGIN with no
   superuser, role creation, database creation, replication, bypass-RLS or role
   memberships. Only CONNECT plus ownership of the empty `storage` namespace is
   provided. If that empty namespace already exists, ownership is transferred;
   no tables/functions/types are fabricated. Existing `supabase_storage_admin`
   stays NOLOGIN. Existing roles and authentication remain unchanged.
4. In a sanitized environment supplying **only** required staging values and normal
   runtime variables, run the generated file with explicit project and env-file:

   ```sh
   docker compose --env-file /dev/null -p baci-isolated-savings -f storage-bootstrap.json --profile official-storage-bootstrap run --detach --no-deps storage-bootstrap
   ```

   Required variables are `ISOLATED_STORAGE_DB_PASSWORD` and the existing isolated
   `ISOLATED_JWT_SECRET`; no root/Auth/REST DB credential enters the worker. The
   official config requires a JWT secret even for migration CLI and may derive
   in-memory API JWTs; they are not emitted by this bundle. No Storage HTTP server,
   PostgREST dependency, queue, vector migration, S3 backend, mail or provider is
   started. File storage is inert temporary configuration, not a persistent backend.
   Both database schema and migration ledger persist in the existing Postgres volume.
5. Capture the returned worker ID and wait for that exact container with
   `docker wait <worker-id>`. Require exit code 0; do not use attached `compose run`
   or inspect logs (upstream failures may contain SQL). Logging retention is off;
   inspect only status/exit/OOM fields. If it hangs, stop that worker and do not
   infer success. The upstream runner has long migration timeouts; impose the
   parent maintenance deadline explicitly.
6. **On success OR failure**, stop the exact worker if still running and execute
   `official-storage-bootstrap-lockdown.sql` through the existing admin channel.
   This revokes LOGIN, clears the password and terminates that role's sessions.
   Wire this step into the parent's finally/trap cleanup before starting step 4.
   It deliberately leaves the NOLOGIN role as schema/object owner. Do not restore
   LOGIN to `supabase_storage_admin`, grant broad role memberships or drop schemas.
7. After successful migration and lockdown, execute
   `official-storage-bootstrap-verify.sql`: required tables/ledger, final migration,
   empty objects/buckets, table ownership, RLS and role lockdown must all pass.
   Remove only the completed worker container after recording exit status.
   Continue Baci schema installation only after these results receive parent review.

This is schema initialization only. Initializer ownership is not a runtime Storage
principal; a later Storage HTTP service requires a separate reviewed permission
boundary. Official migrations apply their own grants/RLS; this bundle adds no
application policies or fake compatibility objects. Partial failures keep their
official ledger; prepare refuses rerun/adoption. Review recovery explicitly rather
than editing hashes, synthesizing ledger rows or resetting the schema.

Local tests validate generated configuration, rejection boundaries and SQL guard
structure only. Parent execution is required to prove the pinned image's packaged
CLI and actual PostgreSQL privilege compatibility. No remote changes, root actions,
production connections, secret reads or DNS operations were performed.

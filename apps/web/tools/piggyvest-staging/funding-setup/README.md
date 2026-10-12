# Isolated PiggyVest staging PostgreSQL TLS and provisioner candidate

**Owner installation is still pending.** Parent review and an independent scoped Terra review cleared the tested rollback and secret-handling behavior on 22 September 2026. Static checks, mocked failure tests, and disposable local PostgreSQL SQL/TLS rehearsals pass; they are not a real VPS installation rehearsal. Use only a separately sealed owner command after a fresh target preflight, not an unpinned copy from this directory.

This directory is a bounded, owner-run candidate for **only** the existing VPS container `baci-isolated-savings-db-1`. Nothing here has been executed against infrastructure. It does not seed `tools/test/piggyvest-runtime-fixture.sql`, change an application `.env`, change gateway leases, publish a Docker port, recreate the container, contact PiggyVest, or touch production data.

For a disposable local SQL rehearsal, run `bash rehearse-provisioner-grants-local.sh`. It uses PostgreSQL 18 from `/opt/homebrew/opt/postgresql@18/bin`, an isolated temporary Unix socket, and a synthetic password. It creates only a minimal local contract schema, runs the unmodified candidate grants and assertions, proves the recovery RPC grants can execute, verifies the `relkind = 'S'` sequence-privilege assertion, and confirms a rolled-back candidate transaction leaves no role behind. Run `bash rehearse-isolated-postgres-tls-local.sh` for the separate local TLS cycle: loopback-only PostgreSQL, generated CA/leaf, trusted FQDN verification, wrong-host and wrong-CA rejection, and same-cluster restoration to `ssl=off`. Neither rehearsal uses Docker or connects to the VPS.

## What the candidate establishes

- Generates a 30-day private CA and a leaf certificate for `piggyvest-db.staging.baci.internal` on the VPS host. The CA and role password stay under `/etc/baci/piggyvest-staging`; the password is mode `0400` and is never printed.
- Copies only the CA, certificate, and private key into the existing writable PostgreSQL data volume, sets `ssl`, `ssl_cert_file`, and `ssl_key_file` through `ALTER SYSTEM`, and calls `pg_reload_conf()`.
- Verifies the leaf certificate and its FQDN using `openssl s_client` on the container's private IP. The installer refuses any published Docker port.
- Creates one `LOGIN NOINHERIT NOBYPASSRLS` role with no object privileges and grants precisely the ten fixture-approved lifecycle, mapping, and recovery RPCs. It refuses to proceed if any `piggyvest_staging` function remains executable by `PUBLIC`; it does not revoke `PUBLIC` or alter any existing role's grants.
- Before the password-bearing `CREATE ROLE` statement, disables statement and duration logging and sets `log_min_error_statement` and `log_min_messages` to `PANIC`; this keeps an ERROR-path failed role statement out of normal PostgreSQL logs.

PostgreSQL 17 documents that `ssl`, `ssl_cert_file`, and `ssl_key_file` are server configuration parameters, and documents that a reload rereads configuration while reporting invalid settings through the server configuration state: [TLS connection settings](https://www.postgresql.org/docs/17/runtime-config-connection.html), [configuration reload](https://www.postgresql.org/docs/17/config-setting.html), and [ALTER SYSTEM](https://www.postgresql.org/docs/17/sql-altersystem.html).

## Owner procedure

1. Copy this directory to the VPS without changing it and run `bash install-isolated-postgres-tls-and-provisioner.test.sh` locally.
2. As `bassey`, run `bash install-isolated-postgres-tls-and-provisioner.sh --check`. This is read-only and confirms the exact container/image, no published port, absent role, host `openssl`, no `PUBLIC` staging-RPC execution, and all ten installed RPC signatures.
3. Review the `--check` receipt, then run `sudo bash install-isolated-postgres-tls-and-provisioner.sh --install` once. It refuses to rotate an existing role, CA, or password; recovery requires a separately reviewed rotation procedure.
4. Only on the host/network namespace running the application, add the private resolution entry as root if DNS is not already supplied: `172.23.0.2 piggyvest-db.staging.baci.internal` in `/etc/hosts`. Re-read the live container IP first; it is intentionally not hardcoded into the installer.
5. The parent application/routing owner must make the root-owned CA file and password available to the executor's existing TLS configuration, set `host` and `expectedHost` to the FQDN, and keep `rejectUnauthorized: true`. This candidate deliberately makes no application or environment change.

## Evidence and blockers

Readonly VPS checks on 2026-09-22 found PostgreSQL `17.6`, `ssl=off`, empty certificate/key settings, no certificate/key files in the container, an absent `piggyvest_staging_provisioner` role, a writable `/var/lib/postgresql/data` volume, and no published container port. The installed RPC signatures matched the runtime fixture exactly. The container lacks `openssl`, so certificate generation must remain on the VPS host before `docker cp`; this retains the same container, network, and port mapping. Local PostgreSQL 18 rehearsals passed the grant/assertion contract, recovery-RPC permissions, rollback cleanup, and the isolated TLS off/on/off cycle with positive and negative certificate verification. That local evidence does not authorize VPS installation. On a failed install, the candidate explicitly restores its checked pre-install `ssl=off` and empty certificate/key settings before reload. It deletes generated TLS and host credential files only after that rollback and any role cleanup are proven; otherwise it reports `manual-required` and retains the artifacts for recovery. It never replaces the complete `postgresql.auto.conf`.

The fixture is present at `/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/test/piggyvest-runtime-fixture.sql`. It is the source for the exact grants, but the candidate explicitly does not seed it. Readonly VPS counts show both `piggyvest_staging.integrations` and `piggyvest_staging.provisioning_integrations` are empty; this is an activation blocker that this setup intentionally leaves unchanged.

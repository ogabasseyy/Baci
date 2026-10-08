# Root-only legacy-history apply wrapper

`legacy-history-owner.py` is a narrow local wrapper for the pinned 10,000-kobo
legacy migration. It does not enroll users, configure services, create roles,
provision credentials, change routes, or run a worker. The collector must first
produce a fresh full report with `ownerSealed`; the wrapper validates that report
and passes only the sealed payload to the reviewed SQL.

## Package layout and pins

The reviewed package contains `manifest.json` plus exactly these hash-pinned SQL
files: `legacy-enrollment-candidate.sql`,
`legacy-enrollment-scope-preflight.sql`, and
`legacy-enrollment-preflight.sql`. The candidate's local `\\ir` includes are
flattened only after each source hash matches. The replay-compat SQL is not part
of this migration bundle. The manifest fixes container `baci-isolated-savings-db-1`,
database `postgres`, system identifier `7685292944002592802`, and deadline
`2026-09-29T15:59:10Z`.

`manifest.json` has exactly the keys `schemaVersion` (integer `1`), `container`,
`database`, `systemIdentifier`, `deadline`, and `files`. `files` maps each of the
three SQL basenames above to its lowercase 64-character SHA-256. No proof or
runtime file belongs in this SQL manifest; the generated package checksum list
separately covers all three Python files and the compiled collector.

The root package keeps SQL and runtime in separate root-owned `0700` directories.
Every input is a single-link regular file owned by root with mode `0600`; all
ancestor directories must be root-owned, non-symlink, and not group/world
writable. The package checksum list must be verified after copy, including
`legacy-history-owner.py`, `legacy_history_owner_proof.py`, and
`legacy_history_owner_diagnostic.py`. Before invoking
the generated launcher, compare its SHA-256 with the package builder's reported
`scriptSha256`; the launcher cannot authenticate its own bytes. Preserve the
checksum list, launcher hash, proof hash and output records in the private audit
directory.

Run the compiled, checksum-verified collector as root in explicit
`--owner-read-only` mode for each attempt. It writes a fresh full JSON report to
`legacy-proof.json`; do not reuse or copy a user-owned/unsealed proof. The report
must be no more than 15 minutes old, not future-dated, before the fixed deadline,
and match the fixed scope and 10,000-kobo total. The proof SHA-256 output hashes
the full report; no proof or provider details are printed.

## Invocation

From the reviewed root-private package, run the wrapper with the package's SQL
directory and the collector's root-private report:

```sh
/usr/bin/python3 /root/baci-legacy-migration.<id>/runtime/legacy-history-owner.py \
  --bundle-dir /root/baci-legacy-migration.<id>/sql \
  --proof /root/baci-legacy-migration.<id>/runtime/legacy-proof.json --check
```

`--check` validates local ownership, modes, manifest hashes, SQL pins and proof
shape only. It makes no database connection and reports
`local-inputs-checked`, never “database ready.” Only an explicit `--apply`
invokes fixed local Docker/psql with `-X -qAt`, `ON_ERROR_STOP`, stdin-only SQL,
and a 90-second subprocess timeout. SQL rechecks the database identity, lease,
proof, authority, exact legacy mapping and balance while holding its transaction
locks. The database's statement timeout is also bounded.

The terminal output must be exactly `migrated` or `already_complete` as the final
psql result. The first means `changesMade: true`; the second means
`changesMade: false`. Any timeout, SQL failure, missing/unknown terminal result,
or transport error after apply starts returns `apply-unconfirmed` with
`changesMade: null`. Do not retry an unconfirmed apply blindly; first obtain an
independent owner read-only reconciliation. A clean `--check` or an installed
foundation does not prove database readiness or activation.

The wrapper requests SQLSTATE-only PostgreSQL errors. An unconfirmed result may
include an allowlisted SQLSTATE, subprocess exit code, timeout flag and bounded
phase/failure identifiers. It never prints raw stderr, SQL, provider proof or
exception text. These diagnostics do not establish whether the transaction
committed.

Run this wrapper on the VPS only through the reviewed owner staging ceremony,
never against another container. No live action is part of local development or
testing. A separate scheduled verifier must
independently refresh the treasury reservation-ready snapshot before any future
worker activation; the migration wrapper does not self-attest or replenish it.

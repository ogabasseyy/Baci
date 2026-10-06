# Root-private financial readiness evidence sidecar

These new helpers collect actual read-only checks. They do not install anything,
commit renewal SQL, enable schedules, start financial replay, contact the provider,
or manufacture the missing public/renewal evidence. The parent owns every host
execution. No existing source or r5 seal was changed by this sidecar.

## Parent-facing API and command

`readiness_evidence.collect(request, now=time.time, run=command, query=database)`
returns a `financial-readiness-evidence-partial` dictionary. The default dependencies
execute the real commands below; injected dependencies are for regression tests.

```sh
python3 "$TOOLS/financial-activation/readiness_evidence.py" \
  --request "$AUDIT/readiness-request.json" \
  --request-sha256 "$REVIEWED_REQUEST_SHA256" \
  --output "$AUDIT/readiness-evidence.json"
```

Both request and output parents must be root-owned 0700 with root-owned,
non-writable ancestors. The request and signing-key files are root-owned 0600.
Output is exclusive-create 0600; existing output is never overwritten. Review and
pin the request digest before execution. CLI output contains only a digest/status,
never JWTs, signing keys, passwords, provider bodies or raw command output.

The request has exactly these keys:

```json
{
  "seal": {"path": "/root/audit/financial-preparation.json", "sha256": "REVIEWED_SEAL_SHA256", "owner": 0, "mode": 384},
  "artifacts": {},
  "signingKeys": {"path": "/root/audit/existing-signing-keys.json", "sha256": "REVIEWED_KEYS_FILE_SHA256", "owner": 0, "mode": 384},
  "snapshotCaContainerPath": "/PARENT_VERIFIED_EXISTING_CA_PATH",
  "phase": "prestart"
}
```

Populate `artifacts` with pinned records of the same four-field shape for all
`readiness_evidence.PATHS` entries and all six `readiness_evidence_timers.STOPS`
timer/service fragments. Paths are exact: the installed worker/replay trees and
`/etc/systemd/system/<unit>`. No alternate installed paths are accepted. Owners
are limited to root, 65531 and 65532. Modes are exact reviewed metadata, expressed
as integers: 0400=256, 0440=288, 0444=292, 0600=384, 0644=420. Only the two
root-owned replay config files may use 0440; both must have group 65532. Worker
background/snapshot configs may be 0600 owned by 65532/65531 respectively.

The signing-key JSON has exactly `receiptToken` and `appToken` string values,
copied privately from existing authority; no credentials are generated. This
sidecar independently verifies actual HS256 signatures, exact audiences/roles,
the four-claim contract, exact Oct6 expiry, issue time and seven-day maximum TTL.
It requires only `prefundedReplay` financial mode, forbids `financialDatabase`,
and binds the private factory config bytes to its reviewed SHA256.
The factory scope is exactly the six source-schema keys: businessId, environment,
expectedSystemId, integrationId, merchantId and treasuryBindingId. It contains no
expiry field. The helper never injects one or rewrites factory bytes; JWTs and the
physical role/binding leases carry the approved deadline.

**Both installed container labels use the preparation seal digest**, not the
worker build-manifest SHA or daemon output SHA. The compiled five artifact hashes
are still verified separately against the reviewed seal; the daemon retains its
reviewed `02420ef...` hash. Isolation validators reuse only existing constructors,
never old lease installers or expiry-check monkeypatches.

## Actual commands and observations

1. Inspect all financial worker/replay containers using the fixed local Docker
   socket. Require reviewed nonroot/read-only/capability/mount/network contracts.
   Background/snapshot containers and recurring timers must be stopped. Replay
   is stopped in `prestart`; `preschedule` requires it running and still isolated.
2. Capture the independent 21-table plus full financial snapshot in one fixed
   identity, repeatable-read/read-only local PostgreSQL transaction.
3. Inspect and start only `baci-prefunded-readiness` and
   `pvb-staging-replay-prefunded-check`. They must already exist, be stopped, and
   have the exact reviewed check command/config mounts. Their respective commands
   are compiled `readiness.cjs --connect` and `replay-daemon.mjs --check`.
   Inspect again: each must exit zero and produce exactly its safe readiness JSON.
   Never start the financial daemon, background or snapshot writer here.
4. Check snapshot TLS without invoking `snapshot.cjs`, provider fetches, snapshot
   recording, or the existing `verify_snapshot_binding` function. The latter
   executes `FOR SHARE`, so it cannot run in a read-only transaction. Instead,
   use the existing psql inside `baci-isolated-savings-db-1`, connecting physically
   over TLS to `piggyvest-db.staging.baci.internal` at reviewed `172.23.0.2`.
   Require `sslmode=verify-full`, matching existing CA bytes, restricted snapshot
   login, exact login expiry, safe capability membership and no unrestricted
   snapshot-writing grant. Password goes via forwarded environment name, never
   Docker argv. Require the database container's project/network/IP identity.
   A separate owner read-only query proves the exact database-system and immutable
   binding/treasury/registry identity join and renewed binding expiry.
5. Read all effective systemd properties and pinned fragment bytes. Require three
   active/waiting Oct6 deadline timers, exact next elapse, no drop-ins/reload
   pending, exact target units and effective stopper ExecStart commands. No
   systemd start/stop/reload is performed by this check.
6. Capture and compare the complete protected snapshot again. Recheck financial
   quiescence/isolation and all installed artifact/config pins. Refuse drift,
   checks taking over 60 seconds, or any step crossing deadline minus 600 seconds.

The parent must make the existing CA available at `snapshotCaContainerPath` inside
the already running database container before execution. This helper only reads
that path; it does not mount, create, rewrite or copy CA material. An absent CA,
missing check container, unexpected metadata or failed TLS connection is a refusal.

## Owner-gate fields and independent renewal receipts

The result supplies actual `tlsReadiness`, `replayReadiness`,
`replayConfigurationChecked`, `snapshotTlsIdentityVerified`, verified JWT fields,
`timers`, container/schedule state, isolation and five compiled artifact pins,
separate snapshot credentials, and `protectedBefore`/`protectedAfter`.
It deliberately omits `public`, `roles`, `snapshotBinding`,
`guardedRenewalCommitted`, `rollbackRehearsalBoundToSql`,
`constraintsAndHistoryPreserved`, and `freshReplayCompletedPass`.

The parent adapter must merge those fields only from actual independent evidence:
fresh authenticated public GET/default-deny POST/PATCH proof, the three-role
before/after fingerprint and commit receipts, the snapshot renewal metadata and
source-guard proof, rollback SQL digest, protected pre/post commit snapshots, and
fresh completed-pass replay evidence before scheduling. Do not replace these with
booleans based on successful installation or current metadata alone.

The optional `readiness_evidence_roles` API collects per-role password,
attribute, privilege/ACL and membership SHA256 values, plus immutable binding
identity and source-pinned guard owner/language/ACL/body checks:

```sh
python3 "$TOOLS/financial-activation/readiness_evidence_roles.py" collect \
  --seal-sha256 "$REVIEWED_SEAL_SHA256" --output "$AUDIT/roles-before.json"
python3 "$TOOLS/financial-activation/readiness_evidence_roles.py" collect \
  --seal-sha256 "$REVIEWED_SEAL_SHA256" --output "$AUDIT/roles-after.json"
python3 "$TOOLS/financial-activation/readiness_evidence_roles.py" compare \
  --before "$AUDIT/roles-before.json" --before-sha256 "$BEFORE_SHA256" \
  --after "$AUDIT/roles-after.json" --after-sha256 "$AFTER_SHA256" \
  --output "$AUDIT/role-fences.json"
```

`collect(seal_sha, query=database, now=time.time)` returns only hash metadata;
`compare(before, after, now)` derives the `roles`/`snapshotBinding` gate fields
only when all fingerprints match, renewed expiry is exact, source guards are
intact, and both observations are seal-bound and no older than five minutes.
**Do not capture both baselines after a renewal and claim they prove that renewal.**
For the already committed three-role and snapshot changes, retain and use the
parent's actual pre-commit fingerprint/metadata and independent commit readback.
This optional collector does not reinterpret the existing receipt formats.

## Dependency closure and local checks

Stage the seven new `readiness_evidence*.py` source modules together, excluding
tests, alongside the existing `protected_snapshot`, `release_contract`, sibling
`card-week-renewal` SQL/source helpers and shared treasury/runtime support modules.
The new bootstrap also resolves the already sealed sibling `contracts/` directory
for `runtime_scheduler.py` and `replay_cutover_runtime.py`; keep those exact r5
contract files in the reseal. Only their isolation constructors/validators are
called, not their old deadline unit/config renderers or installers.
No old seal is edited; parent resealing must include these new files. Both CLI
`--help` commands work from an unrelated working directory.

Run each colocated `readiness_evidence*.test.py` with Python. Tests use synthetic
credentials, mocked host commands and no network. No live host commands were run
by this lane. Disposable PostgreSQL was not started for these new collectors
because host disk space is critically low; actual root SQL/TLS observations remain
parent execution gates, not locally asserted successes.

# Approved sandbox checkout retirement

## Scope and current state

The owner approved retiring only checkout
`d8bcf921-61b3-4647-90e2-5648e4d6967d`. The server currently reports it pending,
without a checkout URL, with its 10,000-kobo reservation still held. A fresh
read-only phone check on 2026-09-29 returned capability disabled and a preserved
100-naira goal balance. No new payment, charge or transfer was started.

The new disposition is `retired_unconfirmed`, not provider failure. The original
collection status remains pending. The audit retains original row fingerprints,
references, scope, operator approval and fresh verification evidence. Late
provider receipts remain reconcilable but cannot fund or credit the retired
operation automatically. Only its unused reservation is released, once.

Customer principal stays 10,000 kobo. The separate company test treasury budget
stays 10,000 kobo total. The original 2026-09-29 15:59:10 UTC deadline is unchanged.
No production, gateway, Nginx, saved-card or auto-debit activation is included.

## Owner sequence

`activation-retire-checkout.sh` is the stable Mac launcher. It asks for the VPS
owner password; credentials are never embedded in this bundle.

1. Copy the pinned runner into a fresh root-private directory and verify its
   hash before execution. The runner verifies every copied payload before imports.
2. Pin the physical database, original intent, sole operation, customer, goal,
   unchanged treasury state, existing deadline and actual mounted test config.
3. GET-verify the original Paystack reference, using only its current mounted
   test credential. Any response except the narrowly expected not-found result
   refuses; that result does not itself mean the collection failed.
4. Rehearse the complete locked SQL transaction with `ROLLBACK` against the
   staging database before touching the deployed application.
5. Upgrade only the dedicated first-card public application to understand the
   terminal status and reject the known invalid email suffix before reservation.
   Preserve its config, container isolation, actual units and deadline. Retain
   the pinned predecessor for automatic application rollback on failed probes.
6. Reverify the provider reference, then commit the audit, irreversible
   operation flag, downstream funding fences and one reservation release in a
   single locked transaction. Protected financial state is rechecked before
   commit and afterward. Unknown commit results remain unconfirmed.

Expect `STAGING_CHECKOUT_RETIRED`. This marker deliberately does not assert phone
readiness. Afterward, verify authenticated terminal refresh and capability through
the real phone origin, confirm the same 100-naira principal, and reload the
updated Metro app. Only the user explicitly starts another bounded sandbox test.
The app clears only the matching retired local intent/key after an authenticated
terminal response; it does not automatically initialize a replacement checkout.

If application upgrade succeeds but SQL refuses, the new application remains
compatible with the original pending intent. A rerun resumes the reviewed app,
then repeats fresh verification. If SQL committed but reporting was interrupted,
the audit and irreversible flag are verified before reporting already retired;
no second release occurs. A changed or newly started operation refuses this
single-attempt repair instead of broadening its scope.

## Verification and limitations

- Real scratch PostgreSQL verifies the full production-shaped snapshot and
  transaction: rehearsal preserves rows, function OIDs/ACLs and schema; stale
  baseline refuses; commit preserves principal and releases exactly 10,000 kobo.
- A separate database race holds retirement uncommitted while seven duplicate
  retirements and two late writes are blocked. Commit permits one release and
  rejects both late advances. Removing the operation fence makes this regression
  fail; the unchanged production fence makes it pass.
- Late receipt evidence is retained for reconciliation, without a savings credit.
  Wrong scope, stale verification, advanced transfer state, active worker leases,
  and insufficient reservation all refuse.
- Focused web tests: 3 suites, 21 tests. Mobile terminal-state handling:
  5 suites, 27 tests. Changed TypeScript files pass Biome.
- Broader prefunded-card backend tests: 88 suites, 799 tests. Deployment upgrade
  tests: 13 installation, 3 entrypoint/recovery, 2 mounted-proof/readiness tests.
  The mounted-mismatch test mocks HTTP readiness and asserts the specific digest
  refusal, not a timeout. Metro is running from the canonical savings worktree
  on port 8082; no Metro restart or phone payment was performed.
- Repository lint/typecheck were attempted and remain blocked by unrelated
  mobile checkout and other existing errors; no repository-wide green claim.
  CodeRabbit refused 230 dirty files against its 150-file limit. Bounded Luna
  review supplements, not substitutes for, that unavailable automated review.
- Source and artifacts are prepared, not yet installed. The owner must run the
  command before the fixed deadline; authenticated post-installation proof and
  the user's new payment are still outstanding.

## Sealed handoff

### Recovery-check correction

The first owner run refused at `existing-runtime-recovery` with
`databaseApplied: false`. Its bundle remains retained at
`/root/baci-checkout-retirement.yF5vOflU`. The app-only upgrade verifier reused a
nonempty credential reader for artifact files. Both pinned artifacts legitimately
contain the zero-byte `node_modules/client-only/index.js`, so the verifier always
refused that file before any swap or retirement. The original installer permits
that exact empty file.

A strict-reader regression reproduced the refusal before the correction. Empty
artifact entries now require exact manifest-approved empty bytes, matching owner,
group, mode, regular-file type, single link, and unchanged descriptor/path identity
through the read. Credential files still must be nonempty; their reader was not
changed. Foreign bytes, unsafe modes, owners/groups, hardlinks and symlinks refuse.
The full pinned predecessor (3,477 files) and replacement (3,459 files) both pass
the real reader and metadata checks in local file-tree rehearsals. Upgrade tests
include the empty module in both old and new fixtures.

Read-only VPS checks on 2026-09-29 at approximately 07:29 UTC confirmed the public
service active, CSRF 200, checkout GET/POST 401, PUT 405, callback 200, and exact
systemd unit hashes. No privileged retry, database write, payment or lease change
was performed by this investigation. The corrected bundle still requires the
owner command; it is not a live retirement or phone-readiness result.

All 47 focused upgrade, retirement and diagnostic tests pass after the correction.
Future refusals include only an allowlisted source-module/line and a fixed reason
code, never exception text or credentials. Mounted-configuration verification has
its own stage. Repository lint/typecheck were rerun and remain blocked by existing
mobile checkout errors; CodeRabbit again refused the 230-file dirty-tree scope.

### Database rehearsal refusal

The corrected owner run in `/root/baci-checkout-retirement.Tp7gsQHh` passed runtime
recovery and mounted-configuration verification, then refused during
`database-rehearsal`. It reported `databaseApplied: false`, not a completed
retirement. The exact SQL failure remains unconfirmed; source review did not find
a deterministic mismatch in the eleven function baseline pins. Do not relax them
or retry a phone payment.

`activation-retirement-diagnostic.sh` is the diagnostic-only Mac command. It
reverifies that retained root bundle and a separately pinned diagnostic module.
It reports function metadata/hashes, GET-verifies only the existing provider
reference, and runs the exact rehearsal with allowlisted statement markers and a
mandatory terminal `ROLLBACK`. Output includes only the failing marker, SQLSTATE
and preservation booleans, not SQL error bodies or credentials. It never installs
the app, starts a payment, changes the lease or commits retirement. Failure or
changed/unknown preserved state produces a nonzero exit.

Five focused unit tests and two scratch-PostgreSQL tests pass. The actual annotated
transaction rolls back without changing rows, schema, function OIDs or ACLs; an
injected baseline mismatch reports `function-guard_operation` / `55000` and leaves
the same state untouched. These tests are not evidence of the live failure cause.

- Diagnostic source SHA-256: `7a291968da0eabd116bf194baf551b3b8a5a2cea390875cec7c77b09312c5e81`.
- Staging directory: `/home/bassey/baci-checkout-rehearsal-20260929-7a291968da0e`.
- Diagnostic prepared for owner execution; no privileged diagnostic run performed.

- VPS staging directory: `/home/bassey/baci-checkout-retirement-20260929-9c77e2ce7c88`.
- Runner SHA-256: `32c08bb84bda321a242b12930bea5940cfe874955f37b613314a684e37285579`.
- Payload-list SHA-256: `9c77e2ce7c882bb42d8a84b97e73baca3650adae7821877b0fbf0536d22fdf1f`.
- New Linux artifact SHA-256: `8f3babb4f2d6a9ecbbdc9d87c8209cbe45dbe6e124b7f059e1e391eeeb113134`.
- Manifest SHA-256: `7790f11a4a4254c5c79d5841e92fc927163f29ed06007466696e9fd4d91f8bf3`.

All 35 staged payload hashes and the isolated owner-module imports were verified
on the VPS without running the owner installer. The approved predecessor and new
artifact both validate against their manifests. The new artifact has no Darwin
entries, retains the exact predecessor Linux native dependency files and matching
Sharp/Next package metadata, and includes the email guard and terminal status.
Terra's user-only Linux scratch run with synthetic configuration reports CSRF 200,
unauthenticated checkout GET/POST 401, PUT 405, callback 200 and six assets 200;
the scratch listener was stopped. This is not an authenticated live payment proof.

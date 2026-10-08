# Exact owner-reviewed paid test reconciliation renderer

This folder renders SQL only. It has no executor, subprocess, provider client,
network access, public route, source-pin override, or production harness mode.
`renderer.render_transaction(bundle, reviewed_sha256)` defaults to `ROLLBACK`.
This is an owner adjudication after independent verification, not a replacement
for the separate provider terminal-status fix or an automatic recovery path.

## Parent-owned prerequisites

The parent must independently verify the fresh Paystack response using the
existing Zod contracts, bind all immutable identity/metadata/email/amount/card
fields, review the original live definition and preflight, quiesce the background
timer safely, and approve this exact intent. The renderer validates the resulting
attestation; it cannot establish provider authenticity or owner approval from
booleans or hashes. Preserve the raw proof, approved pins, source-file manifest,
SQL, complete sanitized execution outcome, and receipt in root-private capture.
Do not expose authorization material, SQL, provider bodies, or raw PostgreSQL
errors through logs or stdout. An error can include SQL and secrets in its
context; the parent driver must capture stderr privately and return only a
sanitized status/SQLSTATE. Disable statement/query logging in that private driver.

The fixed selection is intent `ff561046-58e7-428d-9163-f6e60b0dab65`, goal
`9f01153c-1589-4dde-b9aa-8f644a846832`, and 10000 kobo. AppDB physical system
identifier is `7685292944002592802`; owner/session/database must be `postgres`
over a local Unix socket, before `2026-10-06T15:59:10Z`. New principal must be 0,
old goal `430314fd-cd8b-4579-98d4-e9f345713dd6` must retain 10000 kobo and exactly
one retired checkout, and treasury available/reserved/consumed must be
10000/10000/0. The flagged timestamp must precede the provider paid timestamp.

## Input contract

`bundle` has exactly six keys:

- `source`: the **exact** independently approved live `pg_get_functiondef` text,
  including its trailing newline. SHA256 must be
  `e078268766bdac768b934ff8428be005c6060c89fbeec1bd55c4a6f1c80b7c7f`.
- `scope` and `selection`: the existing typed seven-field/four-field JSON
  contracts, pinned to `contract.SCOPE` and `contract.SELECTION`.
- `collection`: the existing seven-field verified collection with nine-field
  reusable authorization. Pass the existing Zod-parsed provider result.
- `preflight`: `intentSha256`, `operationSha256`, `protectedRowsSha256`,
  `permanentMetadataSha256`, and exact routine OID/owner OID/owner/ACL/definer/
  configuration/language. `snapshot.sql` obtains these using the owner-private
  temp helpers in `state.sql`; capture under `identity.sql` locks and roll back.
  The renderer does not execute these files. Capture source separately as JSON
  to preserve all whitespace; never print its secret-bearing context publicly.
- `proof`: `verifiedAt`, `paidAt`, `responseSha256`, `collectionSha256`,
  `independentlyVerified: true`, `status: success`, `domain: test`, `channel: card`,
  and `reusable: true`. UTC timestamps end in `Z`. Verification must be neither
  future-dated nor more than 60 seconds old at render, preflight, call, and
  postflight. `collectionSha256` uses `contract.digest(collection)`.

`reviewed_sha256` is the independently approved `contract.digest(bundle)`.
`contract.digest` hashes UTF-8 JSON with sorted keys, compact separators,
unescaped Unicode, and no NaN. Database row/catalog digests instead hash
PostgreSQL JSONB text; do not substitute the Python digest for those.

The clone retains the pinned original executor, scope, locking, amount, email,
duplicate, insert, and transition code. Only its schema/name, top owner-private
approval guard, reconciliation early return, and phase allowlist differ. The
approval row stores SQL-derived SHA256 digests of the three approved JSONB
parameters; the top guard checks those plus exact JSONB equality on every call.
The SQL call delimiter is content-derived and checked against the arguments.
permanent original is never replaced. Shape or pin drift refuses rendering.
No trigger is dropped or disabled, phase reset performed, ledger/treasury row
written, limit created, or public grant added. Permanent table locks and global
protected row/catalog digests enforce no other row changes. Defaults granting
temp access to other roles are revoked; only postgres and prefunded_authorizer
can execute the clone. Replayed apply refuses the changed full row hashes.

The parent observed a completed background verification claim with an expired
lease while collection remained pending. Its current full row is separately
pinned; only the three verification-claim metadata fields differ from the
earlier diagnostic. A complete token/expiry pair whose deadline has passed is
allowed, without clearing or changing it. Active or incomplete claims refuse.
The full row hash, idle-worker proof, and permanent metadata checks still apply.

## Rehearsal and apply

Run the rendered rollback through the parent-owned driver only after its approval.
The driver must verify the final rollback and unchanged captured baseline; the
`reviewed_postflight_passed` marker alone is **not** a rollback receipt. The owner
independently reviews a receipt with exactly these fields:

`manifestSha256`, `rollbackSqlSha256` (SHA256 of the exact rollback SQL text),
`preflightSha256` (`contract.digest(preflight)`), `rolledBack: true`,
`postflightPassed: true`, `independentlyReviewed: true`, and `reviewedAt`.

Then render with `mode='apply'`, `receipt=receipt`, and its independently reviewed
`reviewed_receipt_sha256=contract.digest(receipt)`. The same fresh bundle and
baseline must still match; refreshed proof changes the bundle/SQL and requires
a new rehearsal and receipt. Review must be after verification and not in the
future. Apply changes only the final transaction terminator to `COMMIT`.
JSON SQL literals use the same sorted-key serialization before and after a
private bundle round-trip. The exact rollback SQL hash must survive storage and
reload; neither the 60-second freshness bound nor receipt checks are relaxed.
Close the session immediately afterward: the clone/approval guard are dropped
before completion, the approval table drops on commit, and all remaining temp
helpers disappear when the session ends. Full permanent metadata must remain
identical. Never accept partial output as committed success.

## Focused local evidence

Run each `*.test.py` directly with Python, including `postgres.test.py`.
Standard unittest discovery does not discover this repo's dotted filenames.
The PostgreSQL tests reuse existing fixtures in a disposable Unix-socket-only
PostgreSQL 18 cluster. Their private monkeypatches substitute scratch identities,
dates, and the scratch `pg_get_functiondef` hash; the public renderer exposes
no such override. They retain real original promotion/retirement/authorization/
admission triggers and test original no-op, rollback preservation, exact commit,
replay refusal, source/full-row hash changes, amount/goal/scope errors, expired
proof, retired selection, active leases, executor identity, inherited default
ACL removal, postflight unrelated writes, and wrong physical database identity.

These tests verify the algorithm against the scratch definition. The exact live
definition and live provider proof were not fetched or executed by this sidecar.
Parent approval, independent proof, live rollback rehearsal, and actual apply
remain entirely with the parent.

The parent completed an independent live rollback rehearsal and exact apply on
October 2. The existing test payment's collection is verified and its checkout
is `funding_pending`; the permanent promotion function remains unchanged. This
is collection recovery only, not proof of a completed PiggyVest transfer or a
savings credit. The original and new plan principals remained 10000 and 0 kobo
at the independent post-promotion readback, respectively.

## File inventory

| File | Purpose |
| --- | --- |
| `renderer.py`, `renderer.test.py` | Public pure render API, exact receipt and SQL safety checks |
| `contract.py`, `contract.test.py` | Fixed source/scope/proof/pin validation |
| `clone.py`, `clone.test.py` | Exact checked transformation of the approved definition |
| `identity.sql` | Owner/local physical database/deadline guard and table locks |
| `state.sql`, `snapshot.sql` | Protected row/catalog hashing and preflight projection |
| `guards.sql`, `acl.sql`, `postflight.sql` | Private approval/full-row guards, temporary ACLs, exact outcomes |
| `postgres.test.py` | Real disposable PostgreSQL integration/refusal/commit/replay tests for all SQL templates |
| `test_support.py` | Synthetic unit input and test-private hash patches |
| `README.md` | Parent driver contract and evidence boundaries |

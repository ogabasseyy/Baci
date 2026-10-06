# Original signature provenance for prefunded replay

Source-only change. The performance window is still active: no validation, SQL
installation, build, live provider call or deployment has run for this patch.

## Intake and storage contract

The intake verifies `x-pvb-signature` against the exact request bytes before it
passes the original header to persistence. The value is retained exactly, including
hexadecimal case; it is never generated for an old receipt or returned to the
public caller. Encrypted body format and AES-GCM AAD remain unchanged.

New intake calls `accept_signed_piggyvest_staging_receipt` with the existing five
sealed fields plus `p_original_signature`. One database transaction accepts the
encrypted receipt and appends signature provenance. The acknowledgement must
contain `signatureStored: true` as well as `durable: true`; unsigned legacy
acknowledgements are rejected. Failed signature insertion rolls back receipt
insertion. There is no fallback to the old unsigned RPC.

`receipt-signature-storage.sql` is an additive, physically pinned installation
after `ingest-storage.sql`, `replay-storage.sql` and the restricted
`replay-runtime-storage.sql`. It does not rewrite those installed scripts.
It creates a separate forced-RLS table; ingestion can append but cannot overwrite
or delete provenance. Multiple authentic deliveries across key rotation can retain
their respective original headers. A duplicate body does not replace its encrypted
receipt. Financial tables and economic state are untouched by this installation.

`read_piggyvest_staging_receipt_signature` takes the exact receipt UUID, payload
SHA-256 and current claim token. Only the replay worker can execute it. The
restricted executor returns the most recently captured header only while the
receipt is processing under that unexpired claim. No worker table-read grant is
added. Wrong/stale/expired/resolved claims and missing provenance return null.

Original HMAC persistence is not itself settlement proof. The prefunded adapter
still verifies the signature, independently reads provider state, checks its scoped
mapping and applies canonical projection at most once.

## Historical receipts and activation

Existing receipts without a captured header remain unchanged. An actual signed
redelivery can append provenance to the same receipt; this does not automatically
reset its processing, quarantine, attempt count or dead-letter state. Any replay of
an exhausted receipt still needs the separately reviewed lifecycle procedure.
Do not manufacture a header with the provider secret or claim that this patch
recovered a historical header. Prior processed ledger entries are not undone.

After the owner releases validation, rehearse SQL and source together before
activation. Install the additive storage before deploying the new intake, then
deploy the restricted reader and composed replay entrypoint. A new intake against
old storage deliberately returns unavailable rather than acknowledge an unsigned
receipt. Keep the trusted enrollment resolver and application/receipt identity
pins intact. This document is not an executable live installation command.

## Deferred checks

From `/Users/mac/.codex/worktrees/0d77/Baci-app`, after explicit release:

```sh
pnpm --dir apps/web exec vitest run tools/piggyvest-staging/intake-handler.test.ts tools/piggyvest-staging/intake-persist.test.ts tools/piggyvest-staging/intake-server.test.ts tools/piggyvest-staging/schemas/intake-signed.test.ts
python3 apps/web/tools/piggyvest-staging/receipt-signature-storage.test.py
```

The SQL regression source covers atomic failure, exact original header, malformed
input, duplicates, authentic redelivery, role isolation and expired/stale/resolved
leases. Its scratch-only harness additionally covers an identity-pin refusal,
eight concurrent duplicate deliveries and persistence after database restart.
None of these tests has been executed for this patch yet. Run the replay-reader
and composition suites, formatting/typechecks and integration review afterward.

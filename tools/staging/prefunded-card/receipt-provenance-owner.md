# Staging original-signature capture

The live receipt store (`7686901100561231906`) currently keeps encrypted event
bodies but not their original provider signature headers. That is insufficient for
the new prefunded replay path, which must verify the original bytes and signature
before recognising money. The existing isolated application database is separate
(`7685292944002592802`); this upgrade does not write to it.

`receipt-provenance-package.py` builds a checksum-sealed owner bundle from the
reviewed receiver SQL and compiled standalone intake. The root-copy-first owner
command validates the closed file set before executing Python. The installer pins
the existing intake source hash, image, nonroot UID, read-only mounts/root filesystem,
capability restrictions, loopback-only port and exact two staging networks.

The order is additive schema installation, exact function/body/owner/RLS/grant
verification, restricted PostgREST readiness, private artifact backup, pinned
replacement and restart of only `pvb-staging-intake`. The PostgREST probe deliberately
uses an invalid signature argument, expecting `22023` before any receipt insert;
it is not a synthetic financial delivery. Running artifact hash and 405/401 health
responses must pass before the completion marker. Failure after replacement restores
the original bytes and verifies the old intake; foreign intervening bytes are never
overwritten. Publication first captures the existing entry in a private root audit
directory on the same filesystem, revalidates the captured bytes, and hard-links
the root-staged candidate only if the destination is absent. This is an atomic
no-clobber operation, not a check-then-overwrite. Original files remain in the audit
directory. Concurrent changes cause refusal; if another destination appears,
both it and the captured original are retained for owner review. A committed
additive schema is retained if runtime installation fails.

The existing intake configuration, provider secret, encryption key, network,
Nginx, Vercel, replay daemon, treasury, customer goal and card flags are unchanged.
No provider request, card charge, money movement, new worker login, credit route or
lease extension occurs. Future accepted events persist their original signature
atomically with the encrypted receipt before reporting durable acceptance.
This does not reconstruct signatures for old receipts or prove a genuine provider
delivery. Card activation remains a later coordinated runtime/enrollment step.

## Receipt-only database compatibility

The live receipt database is PostgreSQL 16.13 and intentionally has no
`service_role`. The first owner bundle incorrectly revoked privileges from that
absent role and aborted its schema transaction. Live readback confirmed no new
signature objects, unchanged intake bytes and no receiver restart.

Revision 2 revokes optional `service_role` privileges only when that role exists;
it never creates the role. All required-role restrictions remain unchanged. The
SQL regression now rehearses both the receipt-only role set and an existing
`service_role` with broad default privileges, which must be removed from the new
table and both functions. Failure reports include the precise activation stage
and safe command exit/SQLSTATE metadata, never command output or credentials.

## Checks

Run the four colocated owner/contract/artifact/package Python suites. For the contract's
disposable PostgreSQL integration case, set `BACI_RECEIPT_SOURCE_ROOT` to the
approved receiver's `apps/web/tools/piggyvest-staging` directory. Run that directory's
`receipt-signature-storage.test.py` plus its intake, signature, replay-entrypoint,
prefunded-loader and artifact Vitest suites. No production database is used.

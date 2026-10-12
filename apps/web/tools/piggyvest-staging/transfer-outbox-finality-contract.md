# PiggyVest Transfer Outbox Finality Contract

`createDurableOutflowStore` accepts `integrationId`, `businessId`,
`expectedSystemId`, and a direct PostgreSQL executor with the shape
`(text, values) => Promise<{ rows: unknown[] }>`.

The exported `PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS` object is the sole SQL
allowlist for this adapter. `readExpected` takes five values in this order:
system identifier, reference, provider customer ID, business ID, and
integration ID. `compareAndSet` takes twelve values in this order: system
identifier, reference, amount in kobo, currency, source wallet ID,
destination reference, direction, provider customer ID, business ID,
integration ID, provider transaction ID, and terminal status.

Call `findExpected` with reference and provider customer ID before finality
reconciliation. It uses `read_piggyvest_transfer_outbox_finality_scoped` and
returns the persisted `customerId` alongside the compatible expected-outflow
identity. It refuses malformed, multiply matched, or returned rows that do not
exactly match the request and configured business/integration scope.

Only pass a terminal event to `reconcileVerifiedOutflowTerminal` after the
normalizer has observed reference, amount, currency, source, destination,
direction, provider customer ID, business ID, integration ID, and a provider
transaction ID from trusted provider evidence. Missing or unverified identity
remains unresolved and must not cause a resend.

The `piggyvest_staging_ledger_worker` may read scoped finality and apply CAS at
`READ COMMITTED`. The separate `piggyvest_staging_submission_writer`, pinned
by `createTransferSubmissionPostgres` to the expected system, business, and
integration, may only call the submission claim/accepted/unknown-recovery
functions. It has no direct outbox or finality-function privilege.

The CAS changes a fully scoped submitted row once; the same status and provider
transaction ID is a duplicate, while any other existing terminal identity is a
conflict. A claim left by a process crash or an unknown provider outcome is
never resent: complete trusted terminal evidence may recover it through the
submission writer, which records the submitted outbox identity and performs
the guarded terminal transition.

Scoped rows require nonempty reference, destination, source wallet, provider
customer, business, and integration identities. The ledger worker, submission
writer, or table owner may perform the guarded state transition; direct table
privileges remain revoked from the submission writer. Rows must begin in
`submitted` without a provider transaction ID.

Run `bash tools/test/run-piggyvest-transfer-outbox-finality-local.sh` from the
repository root to create a private Unix-socket-only PostgreSQL cluster,
exercise the worker and actual `service_role` logins, run the concurrent CAS,
restart the cluster, and verify persisted finality.

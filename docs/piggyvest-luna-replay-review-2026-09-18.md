# Luna replay foundation review

## Scope and outcome

Luna implemented new replay crypto, worker orchestration, synthetic fixtures and colocated tests under `apps/web/tools/piggyvest-staging/replay-*`. Parent reviewed the source and independently reran the focused tests. This is a local foundation, not an activated financial worker.

## Review corrections

- Unexpected dispatch results must not count as applied credit.
- Missing keys and key/mapping resolver failures are sanitized retryable outcomes, not terminal quarantine or batch-wide crashes.
- Quarantine requires the lease claim token and an atomic fenced persistence adapter.
- Oversized claimed batches fail closed before dispatch.
- Malformed mapping adapter responses are validated and cannot abort later leases.
- Split test fixtures to keep files below 300 lines.

Exact API `pvb_wallet` and provider customer matching are required by the new worker. Existing `resolvePlanWalletMappingAnyOf` first-match behavior is not an acceptable attribution adapter. The current main processor can return `processed` after recording poison failure; that return alone must not be translated to applied credit.

## Remaining activation blockers

There is no production persistence adapter, executable worker entrypoint or deployed replay scheduler in this change. Durable receipt leases/lifecycle, restricted database identities, staging migrations, verified synthetic Baci customer/merchant mapping, idempotent reconciled financial dispatch and real SQL crash/concurrency tests remain required. The encrypted receipt table does not store a plaintext event ID; the durable adapter must derive/bind authenticated event identity rather than assume an existing column.

Adapter-mocked duplicate/crash tests verify orchestration only, not real-database exactly-once financial effects. Staging-only configuration validation is not itself proof that future adapters connect to isolated staging databases.

## Validation

Final focused suite: 19 tests. Agent targeted ephemeral TypeScript check passed; parent root typecheck passed. Root lint is blocked by existing formatting findings in env and ledger/payment-account tests and an unrelated empty catch in the performance tool. These were not changed. No secrets, database writes, mapping insertion, external funding, deployment or financial activation were performed in this delegation.

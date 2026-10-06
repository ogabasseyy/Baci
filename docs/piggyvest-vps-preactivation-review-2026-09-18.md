# Actual VPS preactivation review

## Verified targets

- Receipt database: `pvb-staging-receipts-db`, system identifier `7686901100561231906`.
- Application database: `baci-isolated-savings-db-1`, system identifier `7685292944002592802`.
- Neither database contained `piggyvest_plan_wallets` or `piggyvest_inflow_credits` at this check. Rehearsal mapping claims do not establish an actual staging mapping.
- The application database contains an existing synthetic customer/merchant fixture, but no provider mapping was inserted during this review.

## Bugs reproduced and corrected

1. Runner identity verification was optional and checked only receipt storage. Both receipt and application identity pins are now mandatory and validated before claims. Luna implemented the correction; parent reviewed and ran the tests.
2. Adapter resolve/quarantine ignored a false RPC response and reported success after lease ownership was lost. Two failing regressions reproduced this; adapters now require an exact true result.
3. SQL quarantine checked the claim without locking the receipt, then updated the receipt by ID alone. A concurrent expired-lease reclaimer could take ownership between those statements. The quarantine check now obtains a row lock. A two-session PostgreSQL regression reproduces one stolen claim without the fix and zero stolen claims with it.

## Evidence

- 50 focused replay tests passed across five suites.
- PostgreSQL lifecycle SQL and the two-session concurrency test passed in a newly created local scratch cluster, destroyed after testing.
- Replay DDL and worker-role system-identity RPC passed on the actual VPS receipt database inside a transaction ending in ROLLBACK. No permanent VPS schema changes were made.
- Root typecheck passed. Scoped formatting/lint passed. Root lint remains blocked by existing formatting in env, payment-account, mapping/replay-store tests and an unrelated empty performance catch block.

## Not yet activated

No original receipt replay, permanent migration, mapping seed, new credential or gateway change occurred. Before activation, install reviewed application tables, create the verified synthetic mapping, provision restricted application/receipt worker permissions and both identity RPCs, and configure private gateway-style REST origins. Reconcile current provider transactions before dispatch; replay twice and inspect ledger rows rather than trusting runner counts alone.

The replay adapter still trusts financial dispatch to implement duplicate-content conflict handling. Existing ledger upserts ignore conflicting rows on the same provider transaction ID; review that boundary before broad processing. The storage claim path also classifies missing keys as undecryptable during pre-decryption; avoid treating a key configuration outage as terminal event invalidity. Do not describe the current slice as deployed financial processing.

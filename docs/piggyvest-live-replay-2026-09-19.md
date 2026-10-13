# Live staging receipt replay — 19 September 2026

## Verified on the actual isolated databases

- Receipt database identity: `7686901100561231906`; app database identity: `7685292944002592802`. Both were checked through the restricted runtime roles before claiming receipts.
- Installed receipt lifecycle RPCs and authenticated the one-shot worker using short-lived restricted-role tokens. Connections used private SSH forwards and loopback REST-prefix adapters, not a new public database route.
- Original encrypted receipts were decrypted in memory, validated and processed against the verified staging mapping. No new funding request was made.
- First successful pass: 3 claimed, 2 processed, 1 retryable, 0 resolution failures. The unmapped inflow was not credited.
- Actual app ledger: **2 rows, 20,000 kobo (NGN 200)**. These correspond to transaction IDs `4680cf0b-cd3f-4a74-ad14-bd4cc9876dd4` and `4b898b5a-8952-483c-b981-2976dd8f67e3`.
- Second worker pass: 1 claimed, 0 processed, 1 retryable. Ledger remained **2 rows / 20,000 kobo**.
- Separately invoked the recognition RPC for both existing ledger identities under `pvb_staging_app_worker`, inside a rolled-back transaction: **duplicate / duplicate**.
- Final receipt status counts: **2 processed, 6 quarantined**. Quarantine includes unsupported/verification shapes and the unmapped inflow; it is not proof that all six are malformed. Retryable worker outcomes are distinct from stored quarantine status.
- A read-only provider transaction-list check matched both settled inflows and their amounts against the prior receipt export.

## Bug found and fixed during live replay

The adapter sent recognition RPCs to receipt storage, where the app RPC does not exist (`PGRST202`). It now calls the app database client. A dedicated regression failed before the fix and passed afterward. Existing dispatch tests were extracted into a separate file and updated for the app RPC boundary.

Validation: 57 replay tests passed; typecheck passed; focused Biome check passed. Repository-wide lint remains blocked by unrelated formatting in env and wallet tests and an empty catch in the performance tool. No full-suite or clean CodeRabbit verdict is claimed.

## Remaining work / limits

The manual-only deployment status below is historical. The later automatic deployment and its separate validation evidence are recorded in `piggyvest-automatic-worker-2026-09-19.md`. Customer-facing financial acceptance gates remain outstanding.

This is successful **live staging ledger recognition**, not full savings launch readiness. The worker ran manually once and then once for rerun verification; no continuous worker or public REST gateway was deployed. Preserve the restricted identity checks when operationalizing it. The private runner and ephemeral credentials are not a supported permanent deployment artifact.

Unmapped receipts must remain uncredited until independently verified account ownership exists. Do not create arbitrary mappings to clear quarantine. The verification receipt must never create a financial credit. Customer-visible savings allocation, wallet UI, cancellation/interest behavior and end-to-end app testing remain separate acceptance gates.

No production changes, external messages, real-money movement or additional provider funding occurred in this verification.

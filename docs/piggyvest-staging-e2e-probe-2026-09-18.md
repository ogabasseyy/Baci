# Staging end-to-end probe — 18 September 2026

## Scope

Owner requested testing provider delivery, financial processing, app wiring and the complete savings journey. Tests use the existing synthetic `BACI STAGING PROBE MU6V4RY4` wallet on `https://staging.piggyvest.business` only. No real funds, customer data, production changes or external messages.

## Provider funding attempt

Official contract: https://www.piggyvestbusiness.com/docs/api/funding — POST `/api/v1/transfer/test/funding`, integer kobo, maximum NGN 100,000. Transaction reconciliation contract: https://www.piggyvestbusiness.com/docs/api/transactions.

- Before request at 16:10:22 UTC: provider balance zero; wallet-filtered transaction list empty.
- One request for 10,000 kobo (NGN 100 of sandbox value), accepted at 16:10:30 UTC: HTTP 200, `status: true`, `Funding Processing`.
- Immediate, 30-second, 60-second and 90-second checks (last at 16:12:06 UTC): balance remained zero and transaction list empty, with successful HTTP responses.
- Receipt count before and after remained two, both earlier synthetic smoke receipts; latest receipt timestamp remained 16:00:16 UTC. No new provider-origin receipt observed during this probe.
- Do not repeat the POST just because settlement is pending. Accepted is not settled and does not authorize local credit.
- No diagnosis of provider root cause is established by this bounded observation.

## Processing checks

Terra ran 220 targeted intake, receiver, route, schema, inbox, processor and ledger tests, plus 16 mapping/config tests; all passed. These are local automated tests, not proof of deployed processing.

The deployed receipt service only encrypts and quarantines. There is no lease/decrypt/replay worker feeding the app processor. Financial handling also needs verified provider customer/wallet mapping before writes, semantic event deduplication across differing serialized payloads, retry/dead-letter lifecycle, crash recovery and reconciliation. Keep receipts quarantined until these boundaries are implemented and tested.

Existing app inbox migrations have unresolved protected-file corrections documented in the connection handoff. Do not silently edit or activate them. A future receipt lifecycle schema must be additive; do not mutate the installed intake schema as if unapplied.

## Public app reachability

Fresh unauthenticated checks:

- `/api/webhooks/piggyvest`: HTTP 200.
- `/api/storefront/customer/wallet/piggyvest-plan`: HTTP 404.
- `/ogabassey/account/login`: HTTP 404.

The dedicated public staging deployment is a webhook receiver, not the full storefront backend. Existing mobile `WalletContent` renders `PlanWalletSection` without a live service; its default is a synthetic fixture. Do not flip it until its authenticated API and database origins are verified isolated staging endpoints.

Luna ran 12 targeted mobile suites: 104 tests passed. Existing async React act/config warnings remain; no physical-device or live authenticated UI test was performed.

The audit confirmed the reported variant-selection gap: existing variant IDs are preserved when supplied, but the start-savings product selection does not offer an exact variant picker or pass its ID. The backend provisioning POST still intentionally returns 503 pending a restricted worker. Cancellation helpers pause/resume or cancel future debits, not principal refunds; no connected cancellation UI or plan-wallet-to-purchase bridge was verified. These are implementation gaps, not merely unrun tests.

## Acceptance gates

1. Provider delivery: correlate a genuine provider-generated event with a stored receipt; our signed smoke requests do not count.
2. Processing: verified mapping, reconciliation and exactly-once financial effect under replay/crash tests, followed by deployed synthetic proof.
3. Wiring: isolated staging API/auth, synthetic login and own/cross-tenant checks before switching the existing app UI to live service.
4. Journey: exact variant, price snapshot, funding/progress, cancellation/refund and purchase must be tested through the connected UI. Local fixture tests cannot satisfy this gate.

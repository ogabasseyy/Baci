# Business main-wallet receipt provenance — 19 September 2026

## Finding

The previously unmapped staging inflow belongs to the known business main wallet, not a customer subaccount. It MUST NOT create a customer savings credit or be assigned a fabricated customer mapping.

| Evidence | Verified value |
| --- | --- |
| Receipt ID | `2472e4bb-e500-4ed0-a7b8-b8d02178a4d1` |
| Original payload SHA-256 | `ff600d090aa2ac42893171eed1a2c2f7322516bab8288346ad67194b4b0fa7cd` |
| Receipt transaction ID | `e0687d34-8092-4677-8fe7-6bb5e14746b9` |
| Main-wallet short ID | `01M238` |
| Amount | 10,000 kobo (NGN 100 of staging value) |
| Event classification | `bank-transfer.inflow.success` for the business main staging wallet |

This receipt is separate from the two probe-wallet inflows already recognized as two customer ledger credits totaling 20,000 kobo. The known synthetic non-financial verification receipts are also separate.

## Read-only evidence and method

1. Inspected existing script sources with string literals redacted before considering execution: `/private/tmp/pvb-fund-main.js`, `/private/tmp/pvb-wallet-ids.js`, `/private/tmp/pvb-recheck.mjs`, and `/private/tmp/pvb-replay-live-20260919.mts`. None of those scripts was executed. The funding script identifies the pre-existing main wallet and a 10,000-kobo staging funding operation; source inspection alone does not prove that operation executed.
2. Used a separate GET-only request to the fixed `https://staging.piggyvest.business` wallet endpoint with validated staging credentials, redirects disabled and a bounded timeout. The returned wallet identity exactly matched the main-wallet identity from the existing script. Provider metadata classified it as an API wallet with no subaccount flag, no parent wallet and no API customer association. Its observed balance was 10,000 kobo. No provider transaction-list request was made during this investigation; the transaction ID above comes from the authenticated receipt.
3. Read only the known isolated receipt container, `pvb-staging-receipts-db`, using explicit `BEGIN READ ONLY` transactions ending in `ROLLBACK`. Verified database system identifier `7686901100561231906`. Initially selected the single retryable receipt; the exact-identifier follow-up first checked database identity, then selected only the receipt matching the established ID and digest prefixes. No receipt claim or resolution RPC was called.
4. Decrypted the selected encrypted receipt only in process memory using the existing private intake configuration. AES-256-GCM authentication used the stored authentication tag and the existing version/digest AAD. Recomputed SHA-256 over the original plaintext bytes and matched the stored digest before inspecting the event. Its `pvb_wallet` exactly matched the independently fetched main wallet. Output was restricted to identifiers, hashes, amount and classification; plaintext bytes were cleared after inspection.
5. Earlier sanitized export metadata in `/private/tmp/piggyvest-muse-redacted-receipts-2026-09-18.json` contained two inflows and one non-financial synthetic verification record. It did not establish the ownership of this third financial receipt. The direct wallet comparison above closes that classification gap.

No raw payload, provider secret, bank details or private configuration values were logged or written to this report. No production access, database writes, receipt claims, funding calls, customer mappings or deployments occurred during this investigation.

## Required future worker handling

The worker needs a reviewed permanent-quarantine classification for this verified business main-wallet inflow, preserving its encrypted receipt and audit provenance without creating a customer financial effect. It must not keep treating this known business-wallet event as a missing customer mapping, nor create a fake mapping to clear the retry queue. Other unknown wallets still require independent ownership verification; this evidence does not authorize a general business-wallet classification for every unmapped receipt.

Permanent quarantine is a future implementation and operational action, not a state change performed by this report. The receipt was observed as retryable during investigation. Any business-wallet accounting belongs to a separately specified workflow, not customer savings recognition.

## Subsequent operator action

After independent review and synthetic SQL regressions, the parent applied `operator-quarantine-business-wallet.sql` to the pinned receipt cluster and `postgres` database. The exact receipt ID and full digest matched; processing leases and previously credited states were refused by the guard. The transaction committed successfully.

Post-apply state is `quarantined / unsupported`, with no next retry and an audit classification of `business-main-wallet`. Encrypted receipt bytes and prior lifecycle metadata are preserved. No customer mapping or financial credit was created. The automatic worker remains healthy. The earlier future-action paragraph records the investigation boundary, not the current state.

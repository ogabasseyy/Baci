# Wallet credit, financing and Klump retirement

Date: 2026-11-07. Branch: `codex/wallet-payment-visibility`; PR #4074.

## Status

The replacement implementation is being submitted to PR #4074, replacing the superseded automatic wallet-removal approach. The PR requires CI and review on its latest commit before merge. No production transactions, provider requests, migrations, deployment, billing changes or merges were performed.

The owner approved retaining the full/instalment choice in the payment step and clarified that Klump is closed and must be retired. Klump financing work was removed rather than completed.

## Customer behavior

Wallet credit remains applied when selecting a supported payment method. Show the remaining balance alongside the payment choice. A ₦50,000 invoice with ₦20,000 credit finances ₦30,000; keep the original invoice total and show the credit separately. The financier's own required upfront payment remains separate from merchant wallet credit. Fully credit-covered orders open no provider.

Klump is absent from the web and mobile payment choices regardless of stale merchant settings. New initialization returns 410 before payment lookups or provider work; bookmarked launcher URLs cannot load its SDK. Historical callbacks, transaction recording, verification and reconciliation remain available.

## Accounting and recovery implemented

- `record_order_store_credit`: normal request-scoped authenticated client, including mobile bearer authentication. The owner-checked RPC derives credit from completed wallet/savings ledger evidence under existing payment/redemption locks. It rejects foreign, reversed, refunded, pending, invalid and excessive debits; confirms idempotent projections without rewriting amounts; and fails closed before the provider handoff. Internal-only full-coverage finalizers remain separate.
- Oxygen: immutable gross/wallet/net snapshot at workflow admission. Actual worker booking/claim/finish, saved plans, staging trials, activation and canonical/general reconciliation use the same financed amount. Existing original-rail, environment, pilot, signature and non-wallet gateway fences remain. Activation and down-payment callbacks do not mark merchant settlement confirmed.
- Oxygen recovery: live or uncertain funding freezes invoice and ledger changes, including the actual `order_reversal` cancellation operation. An authenticated cancellation after a safe exit may restore the original wallet debit once, including after confirmed settlement by a recognized replacement gateway. The authorized manual payment RPC can record money received without changing the admitted invoice basis. Uncertain Oxygen commands remain fenced.
- Credit Direct: existing server signing/product allocation/webhook logic uses the residual without subtracting wallet credit twice. A new durable per-order reservation prevents issuing another lender session after an uncertain outcome, survives short-lived token deletion, freezes the funded invoice and binds verified webhook references/amounts. Legacy no-wallet retries retain their prior behavior.
- Browser recovery: retain the server-confirmed wallet debit in the saved-order checkpoint. An automatic wallet balance refresh may reuse that same invoice; server guards decide whether a method switch is safe. Changed carts and missing/uncertain financing orders cannot silently clear the checkpoint and create a fresh charge.

## Material limitations

1. Wallet-composed Credit Direct with a positive platform-retained shipping amount is rejected before signing, preserving the wallet debit. Credit Direct pays the merchant directly; using the ordinary platform-wallet settlement routine would risk creating another merchant wallet liability. Collection/allocation of those retained shipping fees needs a verified direct-settlement contract before enabling this combination. Other eligible payment methods can pay the same saved-order residual when no financing attempt has been reserved.
2. A reserved wallet Credit Direct session that closes or loses its response requires authoritative status/manual recovery. Neither local expiry nor a new session proves cancellation, and no automatic reset/cancellation proof is invented.
3. Uncertain legacy wallet Credit Direct orders or orders switched from another rail fail admission rather than assume an old session is unchargeable. Oxygen still excludes device-savings composition; this change enables wallet credit specifically.
4. Local fixture replay does not establish production schema or provider readiness. The new migrations are unapplied, and no live lender settlement was exercised.

## Cutover and legacy recovery

Before enabling wallet-funded financing, replay the seven migrations in timestamp order in staging. Run the wallet-credit projection, Oxygen funding and Credit Direct reservation harnesses there against disposable fixtures, then verify the migration replay and capability register in CI. The two Credit Direct cancellation migrations restore the original wallet debit after verified capture and recognize both stored cancellation spellings. The Oxygen settlement migration preserves safe replacement-rail cancellation and authorized manual payment recording.

Inventory existing orders with wallet ledger activity before rollout. Review Credit Direct orders that still have a lender session but lack a durable reservation, and Oxygen workflows with wallet activity that lack an admitted funding snapshot. Check the original order, completed debit, lender session and merchant settlement evidence together. A signed lender session can survive a closed popup or expired token.

Credit Direct signing and webhook delivery return HTTP 503 with `CREDIT_DIRECT_WALLET_RETRY_REQUIRED` when a wallet reservation lock is busy. Signing clients should retry the saved order. The webhook sender can redeliver the same event. HTTP 409 with `CREDIT_DIRECT_WALLET_REVIEW_REQUIRED` calls for reconciliation. Metadata cannot establish uniqueness when the reference search is incomplete. Provider item amounts are summed in kobo before wallet verification. Amounts with fractional kobo are sent for review without rounding the provider evidence. Duplicate active references or a truncated set of candidate orders, including an empty page with a positive count, return HTTP 409 with `CREDIT_DIRECT_REFERENCE_REVIEW_REQUIRED` for reconciliation.

The order API returns HTTP 503 for store-credit projection lock contention and HTTP 409 when ledger evidence requires review.

For an unresolved order, keep its saved checkout and route it to operations. Use the lender's authoritative status and settlement evidence to distinguish an active session, a verified capture and a terminal no-capture outcome. Resume or reconcile the existing attempt through the supported recovery path. Hold rollout for affected orders that have no supported recovery path. The migration deliberately leaves ambiguous records without a reservation or snapshot. An amount, session age or client redirect alone cannot justify creating one.

New fully wallet-funded orders finalize through `finalize_wallet_order_payment` in `POST /api/orders` before a lender opens. A saved Oxygen URL with a zero balance is read-only recovery context. If the stored order is still unpaid, operations should verify the wallet finalization outcome before authorizing any retry.

## Validation

- 497 Vitest tests passed across all 22 changed web test files.
- 39 Jest tests passed across four affected mobile test files.
- Scoped TypeScript programs for changed web and mobile modules passed with a 3 GB heap cap. Full Next type generation/monorepo typecheck and CI have not been run.
- Disposable socket-only PostgreSQL regressions passed for credit projection, actual Oxygen migration/runtime recovery and Credit Direct issuer/consume/concurrent session guards. Baselines reproduce the original failures. No connected Supabase database was modified.
- Both affected app lint checks were run. Web initially exposed two formatting/import issues in PaymentStep; these were corrected and its final check was rerun. Existing warnings remain. Diff whitespace and shell syntax are checked separately.

## Review and submission gate

CodeRabbit CLI authenticated and the required pre-commit review command was run again before draft submission. It failed with `rate_limit`: all three included reviews were exhausted, and usage-based review was unavailable because the selected provider account has no assigned seat. Its latest response reported a seven-minute wait. No CodeRabbit verdict was obtained. This is a draft for review, not a merge-ready change; obtain CodeRabbit review and check CI at the resulting exact head before merge. Assigning a CodeRabbit seat or using an Agentic API key resolves the reported usage prerequisite.

## Provider references

- [Credit Direct official checkout sample](https://github.com/lenda-saas/vanilla-javascript-for-checkout): server-signed session/customer/amount and distinct merchant payout event.
- [Oxygen support contract](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/support-apis): separate upfront/setup evidence, callbacks do not establish merchant settlement, and cancellation is before activation.

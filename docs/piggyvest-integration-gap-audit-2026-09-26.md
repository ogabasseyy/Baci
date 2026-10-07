# PiggyVest integration gap audit

Date: 26 September 2026. Read-only implementation and staging review, with two Luna reviewers and parent verification. No application code, provider settings, funds, deployments, credentials, or service configuration changed. This report is the only file added.

## Bottom line

The bank-transfer savings slice has real staging evidence. It is not yet a complete PiggyVest-powered wallet. The largest unfinished connections are provider interest to customer Earnings, card collections to PiggyVest principal, and outgoing payment finality. Purchase/refund execution and phone push delivery also remain incomplete or unproven.

Several pieces exist in source without being connected to the running service. Successful route probes, schemas, preparation receipts, and local ledger tests must not be described as completed financial flows.

## Evidence boundaries

- Receiver/replay checkout: `/Users/mac/.codex/worktrees/0d77/Baci-app`, branch `feat/piggyvest-wallet`, base HEAD `89d61b383b`, 361 dirty entries before this report.
- Savings/mobile checkout: `/Users/mac/Baci-worktrees/cursor-savings-phase1`, branch `cursor-savings-phase1`, base HEAD `2a4a8e40bf`, 1,205 dirty entries. Findings include working files, not just either commit.
- Fresh VPS checks at approximately 11:48–11:54 UTC: gateway, funding, drafts, test-payments, replay, and notification timer active. The isolated application database identity matched the established staging pin.
- Fresh public GET probes: webhook registration endpoint 200; goals, funding, and notifications each 401 without authentication. This proves reachability/auth boundaries, not their authenticated financial behavior.
- Fresh application DB read: the synthetic manual plan is active at NGN 100 of NGN 250,000. Earlier same-day authenticated/provider checks established its funding account and 10,000-kobo provider balance; no new deposit was made in this audit.
- Fresh isolated interest-control GET: interest enabled, requested payout destination retained, rate 0, balance 0. This is a separate unmapped probe, not the phone plan or evidence of interest settlement.
- No production verification, new payment tests, device interaction, or full test-suite rerun was performed. Earlier test reports are not fresh release certification.

## Prioritized findings

### 1. P1 — The deployed receipt worker cannot apply interest payouts

The live bundle at `/home/bassey/pvb-staging-replay/replay.mjs:37562` dispatches only bank inflows. Its matching source decodes interest events but sends them to unsupported quarantine. PiggyVest explicitly lists an interest-payout event in its [webhook contract](https://www.piggyvestbusiness.com/docs/webhooks/events).

Evidence:
- `/Users/mac/.codex/worktrees/0d77/Baci-app/apps/web/tools/piggyvest-staging/replay-crypto.ts:59`
- `/Users/mac/.codex/worktrees/0d77/Baci-app/apps/web/tools/piggyvest-staging/replay-store.ts:165`

There is a second missing connection: the main receiver's interest helper writes `public.piggyvest_interest_payouts`, while the phone's Earnings RPC reads eligible-paid-interest operations in `piggyvest_savings_ledger`. Simply deploying that helper does not complete Earnings.

- `/Users/mac/.codex/worktrees/0d77/Baci-app/apps/web/src/lib/piggyvest/interest-ledger.ts:43`
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/supabase/migrations/20260925130050_customer_savings_engagement_storage.sql:89`
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/supabase/migrations/20260925130100_customer_savings_engagement_events.sql:59`

Fresh staging reads found zero payouts for the phone wallet, zero canonical bindings/operations for the test customer, and no application trigger bridging the payout table. An eligible, reconciled payout must reach the canonical ledger once, with customer/business allocation, gross/net/tax validation, and duplicate/conflict handling. Only then can the existing interest notification trigger run. Pending accrual must remain distinct from spendable paid earnings.

### 2. P1 — Card contributions and auto-debits do not yet fund PiggyVest

The mobile card contribution controls are explicitly disabled. The existing auto-debit path charges Paystack, credits the internal Baci wallet, and allocates an internal contribution. That is not a PiggyVest deposit.

- `/Users/mac/Baci-worktrees/cursor-savings-phase1/apps/mobile-storefront/components/wallet/savings/SavingsPlanCardContribution.tsx:52`
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/apps/web/src/lib/customer-savings-auto-debit-process.ts:236`
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/docs/superpowers/specs/2026-09-26-prefunded-piggyvest-card-savings-design.md:22`

The selected prefunded model still needs the treasury reservation, verified card collection, PiggyVest transfer, settlement reconciliation, and exactly-once contribution projection connected. Keep charging disabled until this is complete. Existing collection/reconciliation metadata helpers are not that bridge.

PiggyVest also documents [T+1 inflow notification with Paystack](https://www.piggyvestbusiness.com/docs/api/t-plus-1). The earlier same-day test returned 403 because this business was not activated. That is an account capability issue, not proof that PiggyVest never supports Paystack. It does not prevent separately implementing the chosen prefunded model.

### 3. P1 — Outgoing transfer finality and recovery are not connected end to end

The deployed replay decoder rejects outgoing transfer and restriction events. The separate main webhook processor has handlers, but those handlers are not the active replay dispatcher. Consequently, implementing a transfer POST alone would leave the running receipt path unable to apply its terminal event.

- `/Users/mac/.codex/worktrees/0d77/Baci-app/apps/web/tools/piggyvest-staging/replay-crypto.ts:46`
- `/Users/mac/.codex/worktrees/0d77/Baci-app/apps/web/src/lib/piggyvest/webhook-processor.ts:40`

The receiver checkout has a correct-path TSQ helper, but source search found no non-test caller for it. The outbox helper applies webhook terminal states; that does not establish a running fallback reconciler for missed webhooks.

- `/Users/mac/.codex/worktrees/0d77/Baci-app/apps/web/src/lib/piggyvest/transfers.ts:181`
- `/Users/mac/.codex/worktrees/0d77/Baci-app/apps/web/src/lib/piggyvest/transfer-outbox.ts:80`

PiggyVest's [wallet-transfer contract](https://www.piggyvestbusiness.com/docs/api/transfers/wallet) explicitly distinguishes 202 acceptance from completion. Its [TSQ contract](https://www.piggyvestbusiness.com/docs/api/transfers/status) provides status lookup. Finish success/failure, unknown outcome, missed-delivery recovery, restriction handling, and single-economic-credit correlation before enabling outgoing customer funds. Obtain genuine wallet-transfer payloads rather than assuming their complete shape from the generic webhook envelope.

### 4. P1 — Buying the device and returning savings are still preparation flows

The purchase UI requests a preparation, not an executed provider payment. The handler keeps fulfilment disabled when dispatch is unresolved. Cancellation similarly prepares a receipt; its dispatch method returns a contract-gap result rather than performing a refund.

- `/Users/mac/Baci-worktrees/cursor-savings-phase1/apps/mobile-storefront/components/wallet/savings/PiggyvestPurchaseBinding.tsx:87`
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/apps/web/src/lib/piggyvest/customer-purchase-handler.ts:20`
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/apps/web/src/lib/piggyvest/cancel-plan.ts:88`
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/apps/web/src/lib/piggyvest/cancel-plan.ts:109`

These are useful guarded foundations, but a completed savings journey still needs approved cancellation economics, actual outgoing settlement, and order/refund accounting. PiggyVest supplies transfer primitives; the app must orchestrate the savings product. Do not assume a missing dedicated savings-cancellation API prevents all implementation.

### 5. P2 — Existing-customer recovery is deliberately limited

PiggyVest documents `returnIfExist=true` and `new_customer:false` in [customer creation](https://www.piggyvestbusiness.com/docs/api/customers/create). The newer provisioner omits that option and only accepts newly-created provenance. Unknown/no-reference outcomes cannot automatically complete.

- `/Users/mac/Baci-worktrees/cursor-savings-phase1/apps/web/src/lib/piggyvest/provisioning-request.ts:47`
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/apps/web/src/lib/piggyvest/provisioning-client.ts:123`
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/apps/web/src/lib/piggyvest/provisioning-recovery.md:21`

This is an intentional fail-closed ownership rule, not a recommendation to flip a flag or accept arbitrary existing identities. The missing product capability is safe adoption/reconciliation of an existing provider customer when the local mapping is absent, with verified ownership and a recoverable customer-facing state. Do not blindly resend an ambiguous create request.

### 6. P2 — Interest economics and ordinary-wallet migration remain unfinished

The user wants PiggyVest to hold ordinary wallet balances, with customer interest only for eligible opted-in savings and the intended business share accounted for separately. Current evidence proves dedicated savings wallets, not completion of that whole-wallet model.

The newer local provisioner supports interest opt-in and a configured payout destination. The deployed phone-plan provisioning script explicitly disabled accrual. An unrelated interest-enabled probe at zero rate does not change that plan or prove the customer's allocation.

- `/Users/mac/Baci-worktrees/cursor-savings-phase1/apps/web/src/lib/piggyvest/provisioning-request.ts:29`
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/piggyvest-goal-funding/provision.py:75`
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/apps/web/src/lib/piggyvest/accrued-interest.ts:155`

Provider support has already confirmed that the split is dashboard-global and cannot vary by wallet. The accepted accrual flag and payout-destination fields are not a per-wallet split API. Complete the allocation design and prove provider-supported routing before treating business interest as customer earnings or vice versa.

The [interest docs](https://www.piggyvestbusiness.com/docs/api/wallet/interest) also describe daily accrual, monthly payouts, and forfeiture after more than four monthly bank outflows. The product's disclosures and eligibility/reconciliation must reflect actual provider rules, not a hardcoded dashboard percentage. The accrual reader intentionally labels units unconfirmed and values non-spendable; that is safe, but a real nonzero accrual/payout must establish the final display contract.

### 7. P2 — Notification generation exists; phone delivery is not proved

The notification timer is active. Fresh staging reads show first-contribution and missed-contribution events, but zero active storefront push tokens and zero delivery rows for the synthetic customer. No interest event exists for it.

Complete token registration and foreground/background delivery verification on the actual staging app. Then verify a genuine credited-interest event, correct amount, deduplication, preferences/quiet hours, and deep-link destination. An active worker or visible notification row is not proof that a push reached the phone.

### 8. P2 — Release and contract status are fragmented

The two heavily modified checkouts and the live bundled worker represent different completion levels. The older contract register still contains activation-blocked statements superseded by working inflow receipt. A source-only audit of either tree can therefore produce a misleading status.

- `/Users/mac/.codex/worktrees/0d77/Baci-app/docs/piggyvest-contract-register.md:3`
- `/Users/mac/.codex/worktrees/0d77/Baci-app/docs/piggyvest-contract-register.md:37`

Consolidate one versioned contract matrix and deployment manifest showing source revision, migrations, adapter entry point, phone backend, and end-to-end acceptance evidence. Existing local tests do not substitute for testing the exact deployed artifact. Re-run release gates after integration; this audit is not a production-readiness sign-off. The staging lease remains scheduled to end on 29 September 2026 at 15:59:10 UTC.

## Genuine provider/configuration questions, not questions we should outsource

1. A nonzero sandbox interest configuration and an accelerated genuine payout test: no on-demand payout endpoint was found in the published API. A normal test deposit or locally simulated event cannot prove provider interest settlement. The separate zero-rate control probe does not reveal why the rate is zero.
2. Reversal/return evidence and wallet-transfer correlation: the public event list/TSQ page do not establish a reversal contract or all peer-transfer fields. Obtain representative evidence; implement the supported cases ourselves.
3. T+1 activation only if choosing that funding route. The earlier 403 is concrete evidence of missing activation, not a request to rediscover parameters already documented.
4. Verify fee responsibility before paid transfers. The [fee settings API](https://piggyvestbusiness.com/docs/api/wallet/transaction-fee) describes session/business-role requirements, a designated fee wallet, and potentially silent invalid-wallet handling. This is not an interest-split endpoint or a per-transfer fee quote. A success-looking response alone is insufficient fee-policy proof.

## Not every unused endpoint is a missing requirement

- `create-wallet.success` and `reserve_virtual_account.success` are not applied by the main processor, but bounded wallet/account polling already provides a valid readiness path. Add event-driven completion if useful; do not label polling itself a defect.
- PiggyVest [scheduled payments](https://www.piggyvestbusiness.com/docs/api/schedules/create) move funds from a source wallet. They are not card tokenization or Paystack auto-debit. Using our own scheduler is valid once funding and recovery are correctly connected.
- Pocket checkout, bulk wallet creation, and other optional channels are not required merely because they appear in the provider docs.
- BVN field validation plus provider identity verification is not automatically a missing local BVN-verification API. Preserve the provider's required identity contract and test real eligible onboarding before production.
- Raw-byte HMAC verification, fail-closed credentials, tenant scoping, and duplicate handling are valuable existing controls; do not weaken them to make a demonstration pass.

## Recommended completion order

1. Connect interest receipts and outgoing terminal events to the correct restricted adapters and canonical customer ledger; add conflict/replay/recovery tests.
2. Reconcile a genuine provider payout to Earnings and a real phone notification. Resolve sandbox rate/payout capability in parallel.
3. Complete the selected prefunded card bridge and scheduled-debit integration, proving exact provider settlement before displayed savings credit.
4. Finish purchase/cancellation/refund execution and safe existing-customer recovery; verify restriction and missed-webhook scenarios.
5. Consolidate and deploy one tested artifact set. Run the full bank/card/interest/exit journey on the phone before any production rollout.

# Mobile Credit Direct paid-order amendment implementation plan

**Goal** — Let a merchant replace an item on an eligible paid order in mobile admin, account for a separate payment, and preserve the original order and invoice.

**Architecture** — Use the existing paid-order amendment command and revision boundaries for persisted changes. Verify the original funding against Baci's ledger regardless of how the customer originally paid. Credit Direct is the first new rehearsal. The pilot is disabled by default.

**Tech stack** — Expo, React Native, Next.js authenticated commands, Supabase and PostgreSQL.

## Scope

- Start with a single unfulfilled NGN line, an equal-price replacement or a higher-priced replacement with an exact, independently verified bank transfer. Cash and POS appear in the development walkthrough. Production collection requires verified evidence for the selected method.
- Reconcile legacy orders and mixed payments from independent source records. Future payment methods can use the same amendment path once their captured payments map to the order ledger and their terms allow the swap. Qualify refunds and later cancellation for each original tender before live use.
- Keep capture, payout, transfer and invoice evidence separate. Credit Direct client completion or an order's paid label alone cannot certify the original capture. Hold any order with missing payment evidence for reconciliation.
- Limit the Credit Direct pilot to equal-price and higher-price replacements. Merchant Finance owns top-ups and refunds. Reconcile the financed balance and any separate top-up independently before finalizing a full cancellation.
- Use the server's replacement quote and the agreed selling price under the existing authorization rules. Show the catalog difference and any independently authorized price override separately. The transfer amount never sets the replacement price.
- Use integer kobo for all arithmetic. An underpayment remains due. An overpayment remains visible and needs an explicit settlement decision. Never turn excess into a successful swap or automatically send it to the financier.
- Preserve the original item revision, paid financing entry, customer identity and order number. Append the captured payment and revised invoice evidence once under the order lock.

## Task 1 — Mobile walkthrough using synthetic data

- [x] Put a development-only entry in mobile admin for a synthetic paid order and a Tecno Pop 20 3 GB / 64 GB replacement. Use the shared payment sheet to enter a transfer, cash or POS payment.
- [x] Test the preview in integer kobo for exact payment, short payment and excess. Require a reference for transfer in the walkthrough. Keep confirmation disabled for a nonzero balance.
- [x] Exercise selection, quote, bank transfer and simulated confirmation in the mobile component tests. The test fixture uses only local screen state and preserves the test order number and original invoice item.
- [x] Rehearse on the Android dev client and verify visibility, layout and data entry on the device. On 22 November 2026 the separate debug app installed on the connected Android phone. Synthetic order `TEST-SWAP-01` showed ₦20,000 due for the simulated upgrade to Tecno Pop 20 3 GB / 64 GB, required a transfer reference, and reached ₦0 due after recording `TEST-BANK-01`. Confirmation preserved the test order number and displayed the Tecno Pop 10 and Tecno Pop 20 as the original and revised invoice items. This rehearsal used local state.

## Task 2 — Verified funding admission and settlement

- [ ] Review the Credit Direct webhook capture path and provider terms, including item substitution and invoice obligations. Prove the captured amount and provider reference for eligible orders through the existing reconciliation path.
- [x] Add an append-only migration for merchant-scoped admission using the reviewed set of original ledger captures. Preserve the existing Paystack admission and refund flow. Refunds and ordinary cancellation on the new admission path require a separately qualified settlement flow.
- [x] Bind a verified bank statement entry and a client idempotency key to the authenticated amendment. Reuse the amendment permissions and existing bank evidence worker boundary. Apply the replacement, exact top-up, inventory changes, and final invoice revision in one transaction.
- [ ] Qualify funding approval and ingestion for additional tenders, including historical entries that still need independent reconciliation. Cover staff permissions, conflicting writes and multi-tender refund allocation. Support independently verified forms of top-up beyond the exact bank transfer.

## Task 3 — Staging and launch gate

- [x] Connect the Android rehearsal to a loopback-only staging service over USB. On 22 November 2026 the phone recorded one simulated ₦20,000 bank transfer under `TEST-BANK-01` and confirmed `TEST-SWAP-01` at ₦149,867.50 with ₦0 due. The local database and the revised PDF survived a service restart. Replays left one transfer and one revision. Baci's PDF renderer produced the same original invoice bytes with Tecno Pop 10 and a revised invoice with Tecno Pop 20 (3 GB / 64 GB). This stage uses a synthetic fixture database. The production Credit Direct command path remains open.
- [x] Rehearse the authenticated database commands on isolated Supabase PostgreSQL 17.6 with synthetic data. Credit Direct and a legacy split cash and transfer order each settled the ₦20,000 upgrade once. Both released the original unit, reserved the Tecno Pop 20 3 GB / 64 GB, recorded the bank credit and audit events, preserved the original invoice, and queued one final revised invoice and customer update. Same-price swaps passed for cash and an unlisted synthetic gateway. The test also rejected cross-merchant access, stale capture amounts, missing or duplicate transfer evidence, new swaps while paused, and settlements requiring a refund. The chronological replay and seven targeted SQL checks passed.
- [x] Render both authenticated invoice projections with Baci's PDF generator. The original shows the Tecno Pop 10 and ₦129,867.50. The revised PDF shows Tecno Pop 20 3 GB / 64 GB, ₦149,867.50 paid and one ₦20,000 bank transfer on the same order. Disable all isolated staging fixture configurations after the run.
- [x] Integrate the mobile order details action with the authenticated workspace, catalog search, preview and confirmation API. The server controls admission. Android stores an uncertain confirmation by user, merchant and order and reuses the exact request when recovering it.
- [x] Sign into the isolated environment from the connected Android dev app and confirm `STAGE-ANDROID-POP20`. The order details refreshed to Tecno Pop 20 3 GB / 64 GB and ₦149,867.50 paid. Verify one ₦20,000 bank transfer, release of the original unit, reservation of the replacement, two amendment audit events, one revised invoice projection and the original invoice under the same order number. An exact API retry returned the same amendment, and the ledger fingerprint matched after the retry and refund and cancellation checks.
- [x] Test settlement boundaries. Existing Paystack partial-refund and cancellation fixtures passed with synthetic provider and bank evidence. Cash and POS submissions on an open amended order were refused without a balance or ledger change. Credit Direct refund and cancellation requests returned the Finance review requirement. Confirm that pause blocks new changes and turn off the isolated configuration after the rehearsal.
- [x] Confirm verified cash and POS top-ups through the authenticated API on isolated staging. Verify evidence ownership, exact amount and retry behavior. Android identifies the tender and staff can select the verified receipt.
- [x] Reconcile a synthetic Credit Direct partial refund after explicit lender approval. Open a fulfillment hold before cancellation and require complete evidence for both the lender and any separate top-up before finalizing. Verify the ledger, inventory and invoices after replay.
- [x] Add authenticated Cash and POS payment recording to Change items. Hosted staging confirmed each synthetic ₦20,000 top-up once after concurrent identical submissions. The application requires a POS receipt reference and includes it in the audit trail. Android component tests covered both methods. Merchant Finance manages pending repayments while fulfillment is held.
- [ ] Verify production web and API deployment, stage no credentials in client bundles, and obtain explicit Ogabassey pilot and Finance approval before a live amendment. Verify the intended replacement's agreed price and availability, original Credit Direct capture and bank statement evidence before selecting a real order.

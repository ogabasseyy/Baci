# Terra completion dispatch — 12 September 2026

Status: implementation dispatched; no completion or launch claim.

## Parent recovery review

Parent accepted the local-test recovery slice after independent review and rerun: five focused suites / 54 tests and the disposable restricted-role fixture pass. Final native log: `/private/tmp/redvault-parent-restricted-role-final.log`. The fixture proves reserve, claim, provider-submission recording, fenced reconciliation claim and processed reconciliation under the disposable role, plus direct ACL entries and private-table/synthetic unrelated RPC denial. It exercises migrations 900–911 and 913 with historical fixtures, not full ordered migration replay. It does not validate PostgREST JWT authentication, production authority, real provider refunds or whole-repository acceptance. Production operational integration remains gated; the earlier requested corrections below are historical.

Follow-up: the recovery transport now constructs local-origin HTTP RPC calls instead of accepting an arbitrary database client. Parent requested executable local-role grant coverage because mocked HTTP does not establish that the proposed restricted JWT role can execute the existing functions. Claim-shape parsing is not JWT authentication; the local server must validate the signature/audience.

## Parent verified-completion review

Migration 913 is not accepted for integration yet. Parent requested append-only 914 corrections for null evidence bypass through SQL three-valued logic, expected test/live domain binding, refund-versus-approval races, frozen bank-code reuse after runtime changes, invalid order/transaction states, and quote-hash binding. Finalizer integration also requires a compatible stable completion receipt and established outbox/inventory semantics rather than fabricated update flags. Availability remains disabled while these corrections are in progress.

Kant's first recovery submission is not accepted yet. The injected runner checks a caller-declared test environment, not the concrete provider key or database target. Parent requested a concrete test-key construction guard, explicit nonproduction transport boundary, invalid-mode rejection, and successful fencing-token propagation coverage. Production transport remains separately unauthorized. The capture worker was also notified that its in-progress mismatch fixtures overwrite the entire valid `data` object, potentially testing missing fields instead of the claimed individual mismatch; correction is required before review acceptance.

## Assignments

- Planck (`01a09556-6b2d-7ea2-abe9-8b17cd5b94ad`): verified positive capture/atomic completion, append-only migration 913, concurrency and negative SQL tests. No caller-controlled eligibility approval.
- Kant (`01a09556-6c0d-7a01-8355-778251972321`): restricted recovery/refund operator transport, dry-run default, fenced reconciliation and ambiguous-submission protection, mocked tests.
- Pasteur (`01a09556-6da8-7e72-933c-9e2676838379`): actual web/mobile checkout acceptance coverage and demonstrated frontend fixes; no demo.
- Parent: current provider-contract verification, cross-slice integration and native runner, review returned changes, final aggregate checks and readiness reconciliation.

All three workers use `gpt-5.6-terra`. Each must return `READY FOR PARENT REVIEW` or `BLOCKED`, with changed paths, tests and precise remaining gates. Completion notifications return to the parent; worker completion is not parent acceptance.

## Scope rules

Ogabassey-only; shared negotiability policy; 10% below ₦200,000 eligible merchandise subtotal before discount, 5% at or above. No excluded items or fees in the threshold. Preserve frozen historical allocations. Hosted bank-filtered UBA payment acceptance is already accepted subject to testing; no Baci card entry or BIN collection.

No commit, push, merge, deployment, production mutation, real payments or email. No additional service-role exception or security-manifest relaxation is authorized. Availability stays disabled pending provider/commercial and acceptance evidence. External settlement guarantees cannot be inferred from an internal hold.

## Current provider documentation checked by parent

- [Metadata filters](https://paystack.com/docs/payments/metadata/): selected bank-card and brand filters are documented. This is not proof of production issuer coverage.
- [Verification](https://paystack.com/docs/payments/verify-payments/): server verification returns transaction status and authorization bank/brand/channel; do not invent an authorization bank-code field or trust callback success.
- [Webhooks](https://paystack.com/docs/payments/webhooks/): Paystack uses raw-body HMAC SHA512 authentication. Durable idempotent handling must precede any duplicate fulfilment.

Implementation and synthetic acceptance can proceed without inventing validated provider configuration. Successful real UBA-card coverage and physical device acceptance remain separately evidenced release gates.

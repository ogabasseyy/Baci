# Owner-confirmed eligible-subtotal tiers

12 September 2026: after reviewing UBA's original and returned MOU, the owner confirmed that 10% below ₦200,000 and 5% at or above ₦200,000 apply to select products. The threshold uses only eligible merchandise before discount. Shared non-negotiable exclusions remain unchanged; excluded merchandise and fees do not count.

## Implementation

- Shared pricing selects one rate from the complete eligible subtotal, then applies existing canonical-group half-up integer-kobo rounding and stable unit allocations.
- Backend catalog-derived quotes use that shared calculation, not request prices.
- Append-only migration 912 validates tier arithmetic against item-bound groups. Shared server eligibility and mandatory signed attachment remain authoritative; there is no duplicated SQL brand policy.
- Existing persisted applications are marked `fixed5_v1`; new drafts are marked `mou_tiered_v1`. Original quote hashes, allocations, replay behavior and stored-net refunds are not repriced. The proof-context wire remains unchanged.
- Web and mobile explain both tiers while displaying persisted discount/payable totals unchanged, including historical quotes.
- Main plan and phased handoff now reflect the owner's tier clarification.

## Verification

- Regression first: updated shared pricing suite failed against flat 5% behavior (eight failing cases), then passed after the change.
- Entire shared suite: 165 files, 1,155 tests passed.
- Backend quote/response/fixture/proof/order-route run: five files, 143 tests passed. Follow-up authoritative threshold tests plus web option: two files, 25 tests passed.
- Agent web presentation integration: four files, 141 tests passed; mobile presentation: two suites, 16 tests passed.
- Parent native database runner through 912 passed. Added mixed-basket test uses ₦100 eligible merchandise, ₦200,000 excluded merchandise and ₦200,000 shipping, retaining 10% on eligible merchandise only. A fully internally consistent forged 5% allocation is rejected. Boundary and historical-allocation checks pass.
- Aggregate lint and typecheck passed. `git diff --check` passed.

## Boundaries

This completes the tier change locally, not the full payment release. Existing provider validation, protected authority review, positive-payment completion and operational release gates remain recorded in `integration-review.md`. No migration was applied remotely, no real payment was made, and nothing was deployed or activated. The earlier full-monorepo failure is not superseded by focused success.

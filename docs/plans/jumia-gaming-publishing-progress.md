# Jumia Gaming publishing progress

Original row 3 is split into read-only preview (3a) and explicit selection controls (3b), both merged. Original row 4 is split into wire contracts (4a), exact-destination metadata/forms (4b), and canonical payload/source preflight (4c). There are **11 remaining PR-sized slices including this PR, 10 after merge**; **10 original milestones remain until row 4 is fully complete**. The count reflects the last explicit split, not completed publishing.

| Original row | Slice | Status |
| --- | --- | --- |
| 1 | Frozen snapshot contract | Merged: #3758 |
| 2 | Merchant-authorized selection API | Merged: #3764 |
| 3a | Read-only Gaming preview | Merged: #3765 |
| 3b | Individual / all-eligible selection controls | Merged: #3773 |
| 4a | Category/attribute wire contracts | Merged: #3774 |
| 4b | Exact-destination metadata/forms | Current PR |
| 4c | Canonical payload/source preflight, including remaining retrieval-contract prerequisite | Pending |
| 5 | Original planned slice | Pending |
| 6 | Original planned slice | Pending |
| 7 | Original planned slice | Pending |
| 8 | Original planned slice | Pending |
| 9 | Original planned slice | Pending |
| 10 | Original planned slice | Pending |
| 11 | Original planned slice | Pending |
| 12 | Original planned slice | Pending |
| 13 | Original planned slice | Pending |

## Selection-controls boundary

- Drafts start empty, stay local to a mounted merchant/immutable selection, and survive page navigation only. A refreshed selection or unmount clears the draft.
- Only available, unchanged products with canonical UUID/source-version evidence can be added. Observed invalid selected rows require deselection, clear, or refresh.
- Select all reads every page of the same frozen selection through the normal authorized endpoint. It commits only after validation of all pages; failure/cancellation preserves the previous draft. Client collection is bounded to 1,000 pages / 100,000 frozen products.
- Draft selections do not feed the existing per-product Submit products action. Category/payload preflight, durable batches, provider publishing, approval reconciliation, deployment, and production verification remain later work.

## Category/attribute wire-contract boundary

- Category and attribute parsing follows the current public [categories schema](https://vendorcenter.jumia.com/api-docs/paths/catalog/catalog@categories.yaml) and [attribute-set schema](https://vendorcenter.jumia.com/api-docs/paths/catalog/catalog@attribute-sets@%7Bid%7D.yaml), verified 2026-10-24. Numeric category codes, required hierarchy/pagination evidence, numeric attribute types/options, UUID attribute-set IDs and optional validation/translation metadata are preserved.
- Malformed required metadata fails at the provider response boundary. Optional fields are not filled with invented defaults. Existing public schema exports remain available.
- Category activity in at least one business client is not proof for a selected destination. No attribute form, destination readiness, payload preparation or publishing is enabled by these parsing corrections.

Verification for 4a uses deterministic schema tests and mocked HTTP through the real catalog helpers/client. No real Jumia write, order, deployment, or production database operation is involved. Local validation, PR review, merge and production verification remain separate gates.

## Destination mapping draft boundary

- The exact integration's provider shop and marketplace key constrain the active business clients offered. A merchant must explicitly choose one; neither country nor cached client fields authorize a destination.
- Category, brand and attribute draft controls reset on destination changes; category changes clear attribute values, and mapping changes revoke category confirmation. Required unavailable or unsupported metadata blocks confirmation.
- These local mapping drafts do not feed the frozen product selection or the independently scoped legacy publisher. Destination/category authorization, canonical product facts, payload preflight, and provider submission remain pending in 4c and later slices.

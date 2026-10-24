# Jumia Gaming publishing progress

Original row 3 is split into read-only preview (3a) and explicit selection controls (3b). There are **11 remaining PR-sized slices including this PR, 10 after merge**. A merged preview is not selection consent or provider submission.

| Original row | Slice | Status |
| --- | --- | --- |
| 1 | Frozen snapshot contract | Merged: #3758 |
| 2 | Merchant-authorized selection API | Merged: #3764 |
| 3a | Read-only Gaming preview | Merged: #3765 |
| 3b | Individual / all-eligible selection controls | Current PR |
| 4 | Original planned slice | Pending |
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

Verification for this slice uses deterministic mocked reads and rendered selection/pagination actions; no real Jumia write, order, deployment, or production database operation is involved.

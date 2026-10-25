# Jumia Gaming publishing progress

Original row 3 read-only preview and explicit selection controls are merged. Content/metadata validation (#3783) is merged. The remaining work is seven strictly sequential delivery groups: R1 canonical preflight and authorized read-only preview (current, not merged); R2 control plane; R3 duplicate worker; R4 dispatch; R5 history/recovery; R6 manual updates; R7 retirement and end-to-end verification. This status is not a claim of readiness, review approval, merge, deployment, or provider acceptance.

| Original row | Slice | Status |
| --- | --- | --- |
| 1 | Frozen snapshot contract | Merged: #3758 |
| 2 | Merchant-authorized selection API | Merged: #3764 |
| 3a | Read-only Gaming preview | Merged: #3765 |
| 3b | Individual / all-eligible selection controls | Merged: #3773 |
| 4a | Category/attribute wire contracts | Merged: #3774 |
| 4b | Exact-destination metadata/forms | Merged: #3775 |
| 4c1 | Retrieval-contract prerequisite | Merged: #3777 |
| 4c2a | Flat create-product schema/type | Merged: #3778 |
| 4c2b | Content/metadata validation | Merged: #3783 |
| R1 | Canonical family preparation and authorized read-only preview | Current; not merged |
| R2 | Control plane | Pending; sequential after R1 |
| R3 | Duplicate worker | Pending; sequential after R2 |
| R4 | Dispatch | Pending; sequential after R3 |
| R5 | History and recovery | Pending; sequential after R4 |
| R6 | Manual updates | Pending; sequential after R5 |
| R7 | Retirement and end-to-end verification | Pending; sequential after R6 |

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
- These local mapping drafts do not feed the frozen product selection or the independently scoped legacy publisher. Destination/category authorization, canonical product facts, payload preflight, and provider submission remain pending in 4c2 and later slices.

## Product retrieval-contract boundary

- Retrieve Products follows the current public [product schema](https://vendorcenter.jumia.com/api-docs/paths/catalog/catalog@products.yaml), verified 2026-10-24. The helper retains its `nextToken` option but emits the provider's `token` query key. Scalar seller-SKU, shop and status filters remain stable across pages; legacy lowercase active/inactive callers emit documented uppercase values.
- Required product/variation identity is validated. Exact nested seller SKUs, string brand/category codes, nullable barcode/price/visibility observations and business-client QC evidence survive parsing without invented defaults. Category/brand metadata endpoints and stock pagination are unchanged.
- All-products retrieval fails on malformed data, provider/network errors, missing or repeated/cyclic cursors and the bounded page cap; it never returns partial success. Empty terminal pages remain valid. The single-page helper stays resumable; no exact-SKU worker is implemented here.
- Deterministic schema and mocked real-client HTTP tests cover this read-only repair. Client observations do not establish stock, approved QC, destination readiness or publishing authority. No provider write, import execution, migration, deployment or publishing enablement is included.

## Flat create-contract boundary

- The new, unused `JumiaCreateProductSchema` / `JumiaCreateProduct` contract follows the public [Create Products schema](https://vendorcenter.jumia.com/api-docs/paths/feeds/feeds@products@create.yaml), discovered through the [OpenAPI root](https://vendorcenter.jumia.com/api-docs/openapi.yaml) linked by the [API documentation](https://vendorcenter.jumia.com/api-docs/). Verified 2026-10-24; source SHA-256: `4d4da07572c93e4869f0219b03266630260c96410161620cc1f7a5ebdf07d3e5`.
- Each record is flat, with numeric create brand/category codes (unlike retrieval's string codes), exact Seller SKU bytes, `{name,value}` attributes, explicit top-level price, stock, and optional local `businessClients` prices. Documented translations, barcode, deprecated supplemental categories, sale-price shapes and unknown supplemental metadata are preserved without defaults. Legacy `variations` / `globalPrice` containers are rejected; the existing `createProduct` POST signature, validation and payload remain unchanged.
- Local outbound restrictions are deliberately stronger than wire optionality: required text is nonempty; top-level currency is explicit instead of defaulting to USD; prices are finite and positive; stock is a nonnegative safe integer. Image URI/primary-field shape and exactly one primary image are checked, not public reachability or quality. Optional client fields and nullable local sale-price fields retain provider requiredness. Sale-date validity and relationships are not validated here.
- This generic contract supports multiple/non-Nigerian clients; it does not enforce the future selected-NG-client/NGN policy, canonical pricing, destination ownership, category confirmation, family/variant rules, required category attributes, content safety, image evidence, remote duplicate checks, or immutable source membership. Parsing is neither authorization nor a READY result and makes no provider-isolation claim. The contract is not connected to the legacy Submit action.
- R1 now has pure canonical-family preparation, an authorized read-only preflight route, and a page-scoped preview in the existing wizard; it remains unmerged and is not publishing-ready. The wizard explicitly checks only selected products on the visible page, shows checked/remaining counts, blockers and `canSubmit:false`, and does not rewire Submit products. Destination-specific category/brand capability and trusted global-price/classification/image evidence remain unproven blockers. The digest is never authorization or a DB snapshot. Later R2–R7 work remains sequential. Synthetic tests do not prove production evidence or permit catalog writes.
- The canonical assembler uses the frozen projection as its only source for product facts, preserves all-or-nothing families and stable variant identity order, and emits explicit typed blockers for unknown provider variation, unsupported stock/attribute serialization, and absent trusted evidence. The separately orchestrated preflight route remains responsible for obtaining and validating evidence; no client-supplied price, stock, classification or image flag is authoritative.

Verification uses synthetic provider-shaped fixtures and local schema/feed tests only. No live tenant data, provider request/write, database mutation, deployment or publishing enablement is included. Local validation, review, merge and production verification are separate gates.

## Content and typed metadata-validation boundary

- The unused pure content helper accepts supplied plain-text facts and returns either all deterministic field errors or the exact raw JSON name, escaped description HTML, a generated `<ul><li>…</li></ul>` and positive finite kilograms. Generated HTML escapes literal markup/entities, never executing or silently stripping them. Create-shaped `name.value` preserves the validated raw title; it does not assume undocumented provider HTML-entity decoding. Titles stay at the stricter 15–60 raw-character boundary pending clarification of the 60-versus-70 guidance; no title truncation, invented description, minimum word count or default weight is introduced. Only explicit `g`/`kg` inputs are converted; a future loader must establish the actual canonical unit.
- Four nonempty bullets meet only the general floor. Seven are required for an explicitly supplied provider `3c` classification. Unknown classification is returned as `provider-classification-required`, not 3C compliance; Gaming is not inferred to be 3C. Every invalid bullet is reported, not removed. This helper does not authenticate its inputs or establish provider acceptance.
- Whole-set metadata validation reuses the numeric 0–8 pure validator, now in `lib/jumia` with compatible UI reexports. It checks required values, exact types, finite numbers, known numeric/text/date rules, active option IDs, unique selections and unambiguous metadata identities. Accepted raw values (including false, zero and accepted optional empty values) are preserved without coercion or defaults. Undefined optional values are omitted; unknown keys, malformed/prototype/accessor metadata and unsupported supplied types fail closed. An unsupported optional type can be omitted. Percentage metadata does not imply an undocumented numeric range.
- Results from whole-set validation are typed local values keyed by `String(attribute.code)`, **not provider attribute strings**. Current official Create Products docs specify attribute values as strings; a single selection ID resolves to the exact active option name, while multi-selection is blocked because no list serialization is documented. Canonical name/description/short-description values override only matching definitions after conflict checks; content validation is rerun. Weight attribute serialization and untrusted/missing evidence still block. Existing UI behavior and the legacy publisher are unchanged.
- R1 pure family preparation, page-loader/schema/digest foundations, family packer, authorized preflight route and selected-page read-only UI preview now exist. The route does not independently re-read or pair source/digest facts and does not establish missing trusted evidence. Existing exact-integration Jumia token refresh and scoped credential-rotation persistence may occur through standard authorization maintenance for metadata GETs; no catalog mutation, feed submission, mapping/product/batch write or image probe is performed. A successful local validation is not READY, authorization or provider acceptance. Final local affected tests, web Turbo lint/typecheck, changed-file Biome and CodeRabbit are complete; R1 remains unmerged pending parent independent acceptance.

### R1 independent-review fix round 1

- Canonical family assembly now compares every non-selected sibling variant attribute and canonical condition before accepting a family; unsupported differences block the whole family. Local stock/price and independently checkable mapping errors are accumulated even when trusted external price/classification/image evidence is absent, while failures still return no product records. Variation values are excluded from independent required-field checks by the provider attribute definition name (not the separate source key); unavailable generated attributes no longer create secondary missing-value errors when listing content is invalid. Feed packing deep-clones nested records. Bullet/variation edits revoke draft category confirmation, and the preflight requires a fresh confirmation bound to the exact current merchant/destination/mapping/page/selection/source-version scope before it can check products.
- Regression-first tests demonstrated the assigned breaks and follow-on review edges before changes (RED cases for sibling axes/condition, missing-evidence local diagnostics, nested packer aliasing, confirmation invalidation, provider-name variation mapping, missing-content false blockers, and duplicate variant diagnostics). Focused tests: `pnpm --filter @baci/web exec vitest run src/lib/jumia/prepare-product-feed-families.test.ts src/lib/jumia/prepare-product-feed.test.ts src/components/products/jumia/jumia-mapping-draft-panel.test.tsx src/components/products/jumia/jumia-product-preflight-preview.test.tsx src/components/products/jumia/gaming-selection-draft-legacy.test.tsx` — 5 files, 34 tests passed. The complete affected Jumia suite passed 193 files / 1,617 tests; web Turbo lint/typecheck passed; changed-file Biome and `git diff --check` passed.
- CodeRabbit `0.9.1` uncommitted review identified the variation-name false blocker, generated-field false blockers with invalid content, and unscoped/duplicated variant attribute diagnostics; all three were corrected and regression-tested. Its remaining trivial recommendation is to consolidate duplicate stock/price checks and modularize the large assembler. Per coordinator direction, that structure-only refactor remains deferred for final whole-branch triage. No load-bearing correctness/security issue from the assigned review remains open. R1 is still unmerged, local, and not provider-accepted.

Current official provider docs verified 2026-10-25 using the public Jumia Vendor Center YAML. Create Products SHA-256: `4d4da07572c93e4869f0219b03266630260c96410161620cc1f7a5ebdf07d3e5`; Attribute Set SHA-256: `7a74759fda4dcf45984fd570412c6dce8cfe4ee76fabfd441b83076691d59763`. The docs state the 1,000-record feed limit, parent-SKU sibling grouping/shared images, one variation field, string-valued attributes, and optional business-client local-currency price shape. They do not establish product-specific destination/category availability, global-price evidence, image quality, classification, or any multi-selection delimiter; those remain blockers.

Provider sources read 2026-10-24 (SHA-256 of fetched bytes):

| Source | SHA-256 |
| --- | --- |
| [Create Products](https://vendorcenter.jumia.com/api-docs/paths/feeds/feeds@products@create.yaml) | `4d4da07572c93e4869f0219b03266630260c96410161620cc1f7a5ebdf07d3e5` |
| [Attribute set](https://vendorcenter.jumia.com/api-docs/paths/catalog/catalog@attribute-sets@%7Bid%7D.yaml) | `7a74759fda4dcf45984fd570412c6dce8cfe4ee76fabfd441b83076691d59763` |
| [Provider-linked content guidelines](https://guidescontentjumiang.wordpress.com/) | `ec7f9beb47dbc5b1de212d0c051f7bbd034239d99883480907b07b81fcf42e7c` |
| [Provider-linked bullet guidance](https://guidescontentjumiang.wordpress.com/2017/04/06/how-to-make-your-highlights-into-bullet-points) | `800d09fa62e991987874bd7ad63e34670d52c8cd20748dce5efddfb2ac978403` |

The API example states 15–60 title characters and four bullets. Its description link (`http://bit.ly/3aazgoU`) redirects to `contentguidelines.jumia.com.ng`, which failed DNS resolution during verification; no word-count acceptance claim is inferred from that unavailable page. Provider-linked historical guidance and supplied classification are policy inputs, not proof of current product-specific acceptance. Pure-helper tests use deterministic synthetic facts; local validation, PR review, merge and production checks stay separate.

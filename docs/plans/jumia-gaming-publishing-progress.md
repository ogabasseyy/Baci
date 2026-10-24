# Jumia Gaming publishing progress

Original row 3 is split into read-only preview (3a) and explicit selection controls (3b), both merged. Original row 4 is split into metadata wire contracts (4a), exact-destination metadata/forms (4b), retrieval contracts (4c1), flat create contracts (4c2a), content/metadata validation (4c2b), canonical family/evidence/digest/packing preflight (4c2c), and authorized source-loading/preview integration (4c3). There are **12 remaining PR-sized slices including this PR, 11 after merge**; **10 original milestones remain until row 4 is fully complete**. The contract-first split does not deliver publishing readiness. Original rows 5–13 remain unchanged.

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
| 4c2b | Content/metadata validation | Current PR |
| 4c2c | Canonical family/evidence/digest/packing preflight | Pending |
| 4c3 | Authorized source-loading/preview integration | Pending |
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
- Row 4 remains incomplete: 4c2b must validate/generate content and numeric-type 0–8 metadata; 4c2c must prepare canonical families, enforce trusted destination/category/brand/global-price/stock and image evidence, compute confirmation-bound deterministic preview digests, and pack whole families all-or-none; 4c3 must reload and authorize source facts for preview. A preview digest must not replace frozen DB snapshot/version/authorization checks. Detailed requirements in the parent publishing plan remain pending; fixtures cannot supply production proof or enable writes.

Verification uses synthetic provider-shaped fixtures and local schema/feed tests only. No live tenant data, provider request/write, database mutation, deployment or publishing enablement is included. Local validation, review, merge and production verification are separate gates.

## Content and typed metadata-validation boundary

- The unused pure content helper accepts supplied plain-text facts and returns either all deterministic field errors or the exact raw JSON name, escaped description HTML, a generated `<ul><li>…</li></ul>` and positive finite kilograms. Generated HTML escapes literal markup/entities, never executing or silently stripping them. Create-shaped `name.value` preserves the validated raw title; it does not assume undocumented provider HTML-entity decoding. Titles stay at the stricter 15–60 raw-character boundary pending clarification of the 60-versus-70 guidance; no title truncation, invented description, minimum word count or default weight is introduced. Only explicit `g`/`kg` inputs are converted; a future loader must establish the actual canonical unit.
- Four nonempty bullets meet only the general floor. Seven are required for an explicitly supplied provider `3c` classification. Unknown classification is returned as `provider-classification-required`, not 3C compliance; Gaming is not inferred to be 3C. Every invalid bullet is reported, not removed. This helper does not authenticate its inputs or establish provider acceptance.
- Whole-set metadata validation reuses the numeric 0–8 pure validator, now in `lib/jumia` with compatible UI reexports. It checks required values, exact types, finite numbers, known numeric/text/date rules, active option IDs, unique selections and unambiguous metadata identities. Accepted raw values (including false, zero and accepted optional empty values) are preserved without coercion or defaults. Undefined optional values are omitted; unknown keys, malformed/prototype/accessor metadata and unsupported supplied types fail closed. An unsupported optional type can be omitted. Percentage metadata does not imply an undocumented numeric range.
- Results are typed local values keyed by `String(attribute.code)`, **not provider attribute strings**. Option ID/name/delimiter serialization, special-field override precedence and per-variation/family policy remain 4c2c. Content preparation cannot fill mandatory metadata automatically: the future canonical serializer must inject authoritative name/description/short-description/weight facts and rerun whole-set validation. Existing UI behavior and the legacy publisher are unchanged.
- Canonical family/source proof, trusted destination/category/brand/global price/stock, image reachability/quality evidence, deterministic confirmation-bound digest and all-or-none packing remain 4c2c; authorized source loading remains 4c3. No network image probing, tenant read, new API/UI, provider write, migration, deployment or publishing enablement is included. A successful local validation is not READY, authorization or provider acceptance.

Provider sources read 2026-10-24 (SHA-256 of fetched bytes):

| Source | SHA-256 |
| --- | --- |
| [Create Products](https://vendorcenter.jumia.com/api-docs/paths/feeds/feeds@products@create.yaml) | `4d4da07572c93e4869f0219b03266630260c96410161620cc1f7a5ebdf07d3e5` |
| [Attribute set](https://vendorcenter.jumia.com/api-docs/paths/catalog/catalog@attribute-sets@%7Bid%7D.yaml) | `7a74759fda4dcf45984fd570412c6dce8cfe4ee76fabfd441b83076691d59763` |
| [Provider-linked content guidelines](https://guidescontentjumiang.wordpress.com/) | `ec7f9beb47dbc5b1de212d0c051f7bbd034239d99883480907b07b81fcf42e7c` |
| [Provider-linked bullet guidance](https://guidescontentjumiang.wordpress.com/2017/04/06/how-to-make-your-highlights-into-bullet-points) | `800d09fa62e991987874bd7ad63e34670d52c8cd20748dce5efddfb2ac978403` |

The API example states 15–60 title characters and four bullets. Its description link (`http://bit.ly/3aazgoU`) redirects to `contentguidelines.jumia.com.ng`, which failed DNS resolution during verification; no word-count acceptance claim is inferred from that unavailable page. Provider-linked historical guidance and supplied classification are policy inputs, not proof of current product-specific acceptance. Pure-helper tests use deterministic synthetic facts; local validation, PR review, merge and production checks stay separate.

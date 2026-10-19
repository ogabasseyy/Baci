# Ogabassey structured discovery

## Approved objective
Replace expanding query-sentence guards with explicit, validated intent for the ChatGPT search tool. Use one structured pipeline for this new MCP implementation; retire the sentence-grammar matcher. Keep semantic production search disabled pending relevance evaluation and owner authorization for its private environment flag.

## Contract
ChatGPT supplies query text for retrieval and a structured intent consisting of OR alternatives. Each alternative contains conjunctive product type, manufacturer brands, model, compatibility target and attribute comparisons. Exclusions apply to every alternative. Server-owned merchant, active status, option price, condition and availability remain authoritative. Unknown catalog facts cannot satisfy an explicit hard constraint.

Catalog discovery metadata is optional validated JSON on products, independent of merchandising category. It stores product type, model, compatibility targets and canonical attributes (numeric storage_gb, ram_gb, power_w and string colour/connector). Variants override only their own attributes. Metadata is maintained through an authenticated merchant-scoped route; no invented enrichment or service-role writes. Existing category-to-type mappings may be used only for unambiguous Smartphones/Laptops/Tablets categories.

## Retrieval and selection
Every search requires validated structured intent; query text supplies retrieval keywords only. Lexical and optional semantic candidates are retrieved independently, deduplicated and combined with reciprocal rank fusion. Candidate loading is bounded and reports incomplete coverage. Each candidate is evaluated as actual base/variant/offer records. Price ranges are applied to matching options before choosing the headline option. Return selected option evidence with the matching price and condition. Unmanaged inventory is eligible without positive quantity, while managed inventory requires positive quantity. Missing option lookups never manufacture prices.

The MCP schema requires intent. For unconstrained browse, ChatGPT supplies an empty alternative; unclear shopper constraints require clarification. Missing or malformed intent is rejected rather than routed through a second matching engine. No existing production consumer of the retired MCP matching path was found; storefront search remains independent. This avoids a second paid LLM query solely to interpret ChatGPT's request. Exact identifiers retain lexical weight; exploratory retrieval can use semantic candidates.

## Execution plan
1. Preserve staged review fixes; add schemas and catalog metadata migration/merchant mutation contract.
2. Implement bounded hybrid candidate retrieval and structured option selection in focused modules.
3. Wire structured intent into the existing search tool and return matching option/coverage evidence.
4. Validate schemas, permissions, option correctness, independent lookup failure and hybrid fallback.
5. Run a separate curated shopper benchmark across alternatives, budget, compatibility, unmanaged stock and paraphrased tool calls. Report candidate recall limits and metadata gaps.
6. Run full MCP tests, affected web lint/typecheck, CodeRabbit and exact-head PR review/CI. Deploy only through authorized flow after gates; audit catalog metadata and live relevance before enabling semantics. Complete ChatGPT/cart QA before submission approval.

## Acceptance and limitations
No price/condition/attribute mixing across variants. No budget violations. No unmanaged zero-stock exclusion. No accessory/handset confusion when product type is specified. Unknown facts stay unknown. Lexical-only search remains usable if semantic provider fails. A bounded candidate scan cannot guarantee global cheapest ordering; expose coverage rather than claim completeness. Production catalog metadata migration/audit and browser QA remain release gates.

## Catalog preparation and release sequence
Apply the appended `20260930150000_product_discovery_metadata.sql` migration before deploying code that projects the new column. It inherits existing product row visibility and merchant write policies. Update public facts through `PUT /api/products/discovery-metadata` with an authenticated merchant session and the existing CSRF contract. The body contains `productId` and `metadata`; it cannot choose the tenant. Review facts against supplier specifications and the merchant's own catalog before saving them. Do not populate model/compatibility by guessing from descriptions. No paid LLM fact-enrichment job is enabled by this change.

Example public metadata:

```json
{
  "product_type": "charger",
  "model": "Fast Charger 20W",
  "compatible_with": ["iPhone 15"],
  "attributes": { "power_w": 20, "connector": "usb-c" }
}
```

Numeric attribute keys use canonical units, not formatted strings. Variant attributes with existing explicit Storage/RAM/Colour keys are normalized to the same units during option selection. A malformed variant override clears the inherited fact rather than borrowing the base specification. Merchandising categories such as Accessories remain unchanged. Missing metadata may be acceptable for a broad request but cannot satisfy an explicit model, product-type or compatibility constraint. Audit coverage before directing all live searches through structured constraints.

## Verification record
`discover-structured-products.test.ts` is a deterministic fixture benchmark, not evidence of live ChatGPT interpretation or live catalog relevance. Its independent scenarios cover hybrid candidate merging, same-option attributes/budget, base/offer condition, unmanaged variants, partial coverage, semantic failure, manufacturer versus compatibility, alternative brands and accessory product types. `server-structured-search.test.ts` exercises the actual MCP tool contract and response. Retired grammar tests are removed with their unused engine; unified-path tests verify required intent and retrieval-keyword behavior. Live shopper-query evaluation and catalog fact coverage are additional release gates.

## Research references
- OpenAI explicit tool contracts: https://developers.openai.com/plugins/plan/tools
- Supabase full-text/vector RRF: https://supabase.com/docs/guides/ai/hybrid-search
- Ecommerce query understanding and retrieval routing: https://www.elastic.co/search-labs/blog/ecommerce-search-governance-improve-retrieval

## Operational bounds and update semantics
`PUT /api/products/discovery-metadata` replaces the entire facts document. Callers must send every fact they intend to retain; omitted fields are removed. This is not a partial PATCH or server-side merge. Validated JSON must fit the database's 16 KiB UTF-8 limit.

The candidate cap is 500 keyword IDs, 500 verified-fact IDs and 200 semantic IDs (deduplicated), followed by at most twelve 100-product hydration batches. Each batch may load applicable variants and offers. Empty-query browsing is capped at 500 products. These are request bounds, not a measured production throughput guarantee. Do not trim candidates to the requested result limit before constraints and same-option budgets are applied: that would hide qualifying products. Validate query latency and database load against the live catalog before enabling the semantic flag; reduce the candidate budget only with relevance evaluation. Truncated price ranges/orderings and failed required option lookups return an incomplete result, preventing an apparently exhaustive price answer. Broad non-price discovery may return a disclosed partial selection.


## Reviewed contract decisions

Mandatory intent is the owner-approved contract for this new MCP integration; no independent query-only production consumer was found. An unconstrained browse uses `alternatives: [{}]`. Do not restore the retired sentence parser as a fallback.

Explicit exclusions also require verified product type: an unknown type cannot prove that an item is not a charger. Populate verified catalog facts before production rollout rather than silently weakening shopper constraints. Custom product types outside the advertised alias vocabulary must use the same canonical identifier on metadata writes and intent inputs; arbitrary plural guessing is not performed.

Variant display retains all purchasable variants satisfying the complete intent and price range, while `matched_option` identifies the single option supplying the headline price. Unmatched, sold-out, or over-budget variants are not advertised as matching options.

### Verified-fact retrieval and rollout coverage

Verified `discovery_metadata` values are an independently indexed PostgreSQL full-text candidate source, fused with keyword and semantic IDs. The invoker RPC uses existing product RLS, merchant/status guards, bounded pagination, and authoritative counts. A source failure retains confirmed candidates and marks coverage partial; price-sensitive results cannot claim completeness. Apply migration `20260930210000_product_discovery_fact_search.sql` before deploying this reader.

Embedding coverage does not establish verified-fact coverage. Audit and populate missing product types, model identities, compatibility and constrained attributes under merchant authorization before mandatory live constrained search. Unknown facts and exclusion checks remain fail closed. Do not classify an empty constrained result as proof the merchant does not sell the requested item until this catalog audit passes.

### Combined retrieval document

Append migration `20261001002000_combined_product_discovery_search.sql` before rollout. Its fixed-config immutable document combines catalog text and verified fact values, plus unit-formatted lexemes derived from canonical numeric attributes (GB, W, inches, Hz). Query text remains retrieval-only; no sentence grammar is introduced. Verified structured constraints still decide identity and specifications after retrieval. Exact model identity and unknown-type exclusions intentionally remain strict. Missing product fetch batches preserve other confirmed results and report partial coverage.

### Follow-up review: coverage and correlated retrieval

Unknown required catalog facts now cause partial coverage disclosure while still failing closed for selection. Verified mismatches remain definitive. The keyword and combined catalog/fact source form one lexical RRF group: each product contributes its best reciprocal lexical rank once, plus an independent semantic contribution. This prevents the shared marketing text from voting twice without losing compound catalog/fact recall.

The replay runner applies current-tree SQL through psql `-f` without `--single-transaction`; its existing orchestration regression verifies these exact arguments. The deployment procedure must likewise use autocommit for concurrent-index migrations. Actual PostgreSQL replay remains a required CI gate. Additive prebuild migration 20260930205900 creates the temporary fact index concurrently before the older IF NOT EXISTS definition; 20261001061000 builds a v2 combined document with equivalent GB/TB/MB lexemes and switches the RPC/index before retiring the previous combined index. No historical migration was rewritten.

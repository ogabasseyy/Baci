# Discovery rule ownership consolidation

## Diagnosis

The structured-intent redesign removed expanding sentence grammar. It did not
remove duplicated option eligibility in SQL recall/browse/facts, MCP hydration
and selection, and storefront presentation. Those independent implementations
allowed stock, policy inheritance and condition edge cases to diverge.

## Owners

| Decision | Authoritative implementation | Consumers |
| --- | --- | --- |
| Public variant visibility, anchors, effective inventory policy, public serialized units, eligibility | Private `discovery.public_variant_option_projection` | Bounded option hydration, variant recall, browse and condition eligibility |
| Selected option price, comparison price, condition and effective quantity | `apps/web/src/lib/resolve-public-product-option.ts` | MCP structured option selector and Ogabassey PDP offer resolver |
| Exact verified identity and attribute constraints | `structuredDiscoveryIdentity` and structured option matcher | Retrieval query builder and final selection |
| Candidate bounds and incomplete-result disclosure | Candidate loader and `discoverStructuredProducts` | MCP search response |

SQL remains responsible for inventory that requires database/branch visibility.
TypeScript consumes projected public quantities; it does not recount serials.
The PDP adapter still resolves user-selected attributes and formatting, while
MCP still evaluates complete structured alternatives. Neither adapter owns the
selected option value precedence anymore.

## Additional boundary audit

- **Identity:** exact model/compatibility normalization differs intentionally
  from lossy retrieval words. Keyed digests preserve distinctions; SQL/JS
  Unicode fixtures are required when changing these contracts. Retrieval is
  candidate generation, never proof of a hard fact.
- **Limits:** fact, browse and recall eligibility must precede their caps.
  Lexical/semantic retrieval is bounded candidate generation; truncation or
  lookup failures must propagate partial coverage, and ordered price scans
  cannot claim completeness after those failures.
- **Option handoff:** the selected option identity must survive the widget and
  storefront URL; an option price must not advertise a different base item.
- **Migrations:** additive replacements preserve serving functions/indexes until
  replacements exist. SQL runtime fixtures must run under the intended public
  role against populated data, not just check migration source text.
- **Catalog facts:** embedding coverage does not establish verified metadata
  coverage. Publication RLS and fact coverage remain separate rollout gates.

These are explicit ownership and validation boundaries. They do not establish
that every possible defect has been eliminated. Keep future changes scoped to
one contract and update its consumers/parity fixtures together.

## Verification

Canonical SQL fixtures cover serialized strict/unlimited, inherited policies,
nullable child quantities, managed/unmanaged parents, tenant/publication and
anchor exclusions. Consumer tests compare canonical values with PDP selection;
MCP price/condition/stock regression suites verify its adapter independently.
Exact-head DB replay and current-head review remain merge requirements. Local
fixture checks are not production rollout or real shopper relevance evidence.

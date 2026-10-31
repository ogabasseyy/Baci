# Baci capabilities and agent access

Reviewed 31 October 2026 against source revision
`76b52d16ce856105e0be54f9d264e9457369f305`. Added an agent surface evidence
table with explicit unknowns for the seven agent surfaces; the cited capability
claims are unchanged. This is a navigation map, not authorization or proof of
current deployment. Check the current implementation, live tool discovery and
merchant entitlement before calling or claiming a tool.

Baci's positioning is **agent-native commerce infrastructure for African
merchants**: merchant-owned stores, structured discovery, controlled transactions
and business operations. Mission is not a measured outcome or protocol approval.

## Start here during code exploration

- [Reviewed capabilities](baci-capabilities.json): web and mobile-admin claims,
  restrictions and exact source references. `code_evidenced` is not `live`.
- [Evidence maintenance](capability-evidence-workflow.md): freshness, rollout
  proof, pricing checks and scoped Repomix packs. Do not pack environment files,
  private customer data or credentials.
- [Public features](../../apps/web/src/app/(platform)/features/page.tsx) and
  [machine-readable feature mirror](../../apps/web/src/lib/llms-markdown-platform.ts)
  describe capabilities; they do not grant access to execute them.

| Merchant workflow | Web starting point | Mobile-admin starting point |
| --- | --- | --- |
| Buy/connect domains | `apps/web/src/app/dashboard/domains/` | `apps/mobile-admin/app/(admin)/domains/` |
| Jumia integration | `apps/web/src/app/dashboard/channels/` | `apps/mobile-admin/app/(admin)/sales-channels.tsx` |
| Payments | `apps/web/src/app/dashboard/settings/payments/` | Payment configuration screens; verify gateway/country rules |
| Shipping | `apps/web/src/app/dashboard/settings/shipping/` | Order shipment actions; verify provider coverage |
| Orders, invoices, receipts | `apps/web/src/app/dashboard/orders/`, `apps/web/src/lib/invoice-generator.ts` | Order detail and manual-entry flows |
| Staff permissions | `apps/web/src/app/dashboard/staff/` | Staff screens and merchant authorization hooks |
| Catalog/imports | `apps/web/src/components/products/csv-bulk-import-dialog.tsx` | Products and inventory screens |
| Expenses/profit/follow-ups | Refer to reviewed capability source refs | Expenses, analytics and `useFollowUpQueue.ts` |

Always trace UI → validation → identity/permission → business service → RLS
before turning a dashboard action into an agent tool. A button or API filename
does not prove a complete supported workflow.

## Actual agent surfaces: keep the actors separate

| Surface | Evidence | Current boundary |
| --- | --- | --- |
| Shopping MCP | `apps/web/mcp-server/server.ts`, `apps/web/mcp-server/agentic-ucp-tools.ts` | Ogabassey buyer-facing catalog, cart and checkout tools; `OGABASSEY_SLUG` is fixed. Conditional registration depends on runtime configuration. Guest OAuth candidate (`apps/web/mcp-server/guest-oauth-runtime.ts`, `apps/web/mcp-server/guest-oauth-http.ts`, `apps/web/mcp-server/register-connected-cart-read.ts`) binds cart authority to a guest connection without a shopper account. Connected discovery omits stateless `prepare_storefront_cart_link` and `add_to_cart`; anonymous discovery preserves both for existing callers. Production defaults off. Owner-approved isolated QA has storage and scoped credentials; real browser consent, authenticated discovery and fresh-session cart mutations pass. Conversational ChatGPT add/remove and website handoff into empty Incognito guest checkout pass. Native-app acceptance remains pending. On 2026-10-23 the owner authorized guest OAuth activation only for the new `/submission/mcp` endpoint after clean review and CI; activation is not yet deployed or verified. The original connection and old app configurations must be preserved. The resource URL override is same-origin HTTPS without credentials, query or fragment; path-specific discovery matches that exact resource. Reserved HTTP routes and ambiguous encoded paths are rejected. Consent admission uses a shared resource-scoped 600-per-five-minute budget with bounded backpressure; a separate tenant-wide 2,000 retained-grant ceiling leaves headroom for existing sessions. Initial connected widget adds read the current quantity first. Encrypted 30-second refresh receipts recover a lost rotation response; later reuse still revokes the family. Transport follows the configured resource path, consent tabs use independent cookies, and expired OAuth workers fail readiness. Widget refresh reports connected cart items missing from its catalog. The private cart text-continuation candidate defaults off; activation requires separate owner-approved configuration and live client privacy/retention qualification. Not a multi-tenant Baci admin connector. |
| Merchant storefront protocols | `apps/web/src/app/.well-known/acp.json/route.ts`, `apps/web/src/app/.well-known/ucp/route.ts`, `apps/web/src/lib/agentic/` | Merchant-scoped ACP/UCP discovery, catalog, carts, checkout and orders; enabled capabilities/auth/payment readiness apply. A REST interface is not automatically an MCP tool. |
| Browser tools | `apps/web/src/components/storefront/webmcp-storefront-tools-builder.ts` | Browser-bound storefront tools. Inspect current registrations and browser session authority. |
| Merchant connector gateway | `apps/web/src/lib/connector/manifest.ts`, `apps/web/tools/connector-gateway/` | R0 manifest names (version `r0.4`, data-only, no routes) for four read-only tools planned for the R1 pilot: `orders.list`, `orders.get`, `inventory.levels`, `analytics.summary`. The gateway implementation — scoped owner grants, branch selection, tool-time permission checks and revocation — lives in `apps/web/tools/connector-gateway/`, but the R1 pilot runtime is unverified; do not treat these tools as pilot-callable. REST/OpenAPI, not a ChatGPT MCP server. |
| Store-builder ChatGPT integration | Source implementation not established in this audit | Architecture proposals are not deployed tools. Do not claim storefront creation, publishing, domain purchases or Jumia writes are exposed to ChatGPT. |

The storefront support-chat health check probes catalog and conversation paths.
For Ogabassey it also checks tenant and catalog-lookup response markers. A
passing probe does not establish deployment or transaction readiness.

The merchant connector's runtime and revision must be freshly verified before
use. Older R0 notes advertise unavailable inventory/analytics operations; current
R1 source exists, but source alone does not prove the deployed gateway version.

## Agent surface evidence

One row per agent surface, so an unproven surface cannot borrow another's
status. Status columns hold `unknown` (nothing evidenced), `not applicable` (the
check does not apply to the surface), or `pass` or `fail` followed by a date and
a link or commit as evidence. A test that pins a known gap (`it.fails`) or a
documented limitation is recorded as `fail`, because what it pins is a failure
of the surface. `Source revision` is the commit the row was reviewed against.
The table is validated by
`apps/web/src/lib/agentic/evidence/agent-surface-evidence.repository.test.ts`; the
production observations come from the
[31 October 2026 baseline](../superpowers/evidence/agentic/2026-10-31-baseline.md).

| Surface | Partner | Protocol version | Merchant | Source revision | Local test | Staging | Production | Partner receipt | Market and currency | Eligible products | Authentication | Next check owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OpenAI MCP handoff | OpenAI (ChatGPT apps over MCP) | MCP `2025-06-18`, advertised by `apps/web/src/app/.well-known/mcp/server-card.json/route.ts`; the latest spec is `2026-07-28` (F40) | Ogabassey only (`OGABASSEY_SLUG` in `apps/web/mcp-server/server.ts`) | 76b52d16ce856105e0be54f9d264e9457369f305 | fail 2026-10-31 [MCP 2026-07-28 fixtures](../../apps/web/src/lib/agentic/fixtures/mcp-2026-07-28/mcp-fixtures.test.ts) | unknown | unknown | unknown | Nigeria, NGN | Ogabassey catalog tools; the shopping checkout tools register only when `MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS` is `true` or `1` (default false) | Anonymous discovery (the server card says authentication is not required); checkout tools call the signed agentic API with a server-held credential | ogabasseyy; roadmap Task 5 |
| ACP direct checkout | OpenAI (ChatGPT checkout over ACP) | `2026-04-30`, `2026-04-17` and `2026-01-01` in `apps/web/src/lib/agentic/request-integrity.ts` (lines 5 to 10); `2026-04-30` has no ACP release and `2026-04-17` is the latest (F41) | The one configured agentic merchant (Ogabassey) | 76b52d16ce856105e0be54f9d264e9457369f305 | fail 2026-10-31 [ACP 2026-04-17 fixtures](../../apps/web/src/lib/agentic/fixtures/acp-fixtures.test.ts) | unknown | unknown | unknown | Nigeria, NGN (`apps/web/src/lib/agentic/acp-discovery-profile.ts` lists NGN and en-NG only) | Merchant products the checkout quote can price; used and refurbished eligibility is not evidenced (roadmap Task 8) | Bearer API key plus HMAC-SHA256 request signing declared in `apps/web/src/lib/agentic/agent-commerce-manifest.ts`; not partner-scoped | ogabasseyy; roadmap Task 5 |
| Google UCP cart | Google (UCP cart transfer) | UCP `2026-04-08` (`apps/web/src/lib/agentic/ucp-profile-constants.ts`); Google's cart supports create-and-transfer (`POST /carts`), and update and cancel are optional in the sandbox | The one configured agentic merchant (Ogabassey) | 76b52d16ce856105e0be54f9d264e9457369f305 | fail 2026-10-31 [UCP conformance baseline](../../apps/web/src/lib/agentic/fixtures/ucp-conformance.test.ts) | unknown | unknown | unknown | Nigeria, NGN | Storefront carts; `apps/web/src/lib/agentic/ucp-shopping-profile.ts` declares cart whenever agent auth is configured, even for a merchant not enrolled in shared cart (F34) | The same bearer and HMAC scheme as ACP; whether Google can authenticate is unverified (F8) | ogabasseyy; roadmap Task 3, then Task 9 |
| Google UCP native checkout | Google (UCP checkout) | UCP `2026-04-08`; declared only when all five checkout session capabilities and links exist (`apps/web/src/lib/agentic/ucp-shopping-profile.ts`) | The one configured agentic merchant (Ogabassey) | 76b52d16ce856105e0be54f9d264e9457369f305 | unknown | unknown | fail 2026-10-31 [production baseline](../superpowers/evidence/agentic/2026-10-31-baseline.md) | unknown | Nigeria, NGN | Not decided; used and refurbished goods must not be marked eligible (roadmap Task 8) | The same bearer and HMAC scheme as ACP; Google enrollment and merchant account linking are roadmap Task 11 | ogabasseyy; roadmap Task 11 |
| Paystack-hosted Google Pay | Google Pay through Paystack | Handler `com.google.pay`, versioned `2026-04-08`, built at lines 102 to 119 of `apps/web/src/lib/agentic/ucp-discovery-profile.ts` | The one configured agentic merchant (Ogabassey) | 76b52d16ce856105e0be54f9d264e9457369f305 | unknown | unknown | unknown | unknown | Nigeria, NGN | None established: once its Paystack gateway configuration is set the profile lists Google Pay, but completion creates a Paystack dedicated virtual account instead of charging the Google Pay token (`apps/web/src/lib/agentic/agent-commerce-manifest.ts`) | Paystack gateway merchant id and Google merchant id from environment configuration; no token-charging path | ogabasseyy; roadmap Task 13 |
| First-party storefront chat | none (Baci storefront chat) | none (first-party HTTP API) | Ogabassey (tenant echoed by `apps/web/src/app/api/chat/chat-tenant.ts`) | 76b52d16ce856105e0be54f9d264e9457369f305 | unknown | unknown | unknown | not applicable | Nigeria, NGN (Ogabassey storefront); other currencies unverified | Ogabassey products from the chat's own projection of `products` and `get_storefront_product_variants` (`apps/web/src/app/api/chat/fast-catalog-data.ts`); price, offer and stock parity with UCP and ACP is unverified (F30) | Anonymous storefront visitors with IP rate limiting (`apps/web/src/app/api/chat/route.ts`); the chat can cancel an unpaid, unfulfilled order given its order reference and the customer's email (`apps/web/src/ai/chat-order-cancellation.ts`) | ogabasseyy; roadmap Task 7 |
| Multi-merchant onboarding | none yet | none (applies to ACP, UCP and MCP) | One merchant: `apps/web/src/lib/agentic/agentic-merchant-slug.ts` reads a single configured slug and `apps/web/src/lib/agentic/agent-commerce-manifest.ts` enables signed reads only for it | 76b52d16ce856105e0be54f9d264e9457369f305 | fail 2026-10-31 [two synthetic merchants](../../apps/web/src/lib/agentic/test-support/synthetic-merchants.test.ts) | unknown | unknown | unknown | Nigeria, NGN only so far | None beyond the configured merchant | One shared agentic API key and signing key; no partner-scoped credentials (roadmap Task 5) | ogabasseyy; roadmap Task 5 |

## Next connector implementation slice (planned, not shipped here)

Use one multi-tenant merchant connector, separate from the shopping MCP. Build
focused tool groups over existing authoritative business services:

1. Read-only capability discovery and merchant readiness. Return only entitled
   workflows, explicit unavailable reasons and supported next actions.
2. Storefront draft creation/read/update; keep publish a separate approved action.
3. Catalog, inventory, orders, shipping, domains and marketplace reads. Add
   staged writes only after exact permission, idempotency and audit coverage.
4. Purchases, payment changes, fulfillment and publishing require Baci-owned
   approval proof; do not rely on a model's claim of consent. Domain checkout
   should hand off to the approved payment flow, not let a tool invent charges.

Tool schemas/descriptions must include actor, tenant, inputs, outputs, scopes,
read/write semantics, retry behavior and safe error/unavailable states. Filter
discovery by permission, and enforce authorization again at invocation. Never
replace user-scoped RLS with a service-role client to expose more features.

Validate tool discovery, cross-tenant denial, role restrictions, revocation,
stale approvals, duplicate writes and failure recovery in a disposable test
environment. Public metadata must not disclose source paths, credentials or
merchant-private data. Connector registration/submission and provider approval
remain separate release gates.

## Official design references

- [OpenAI: define focused tools](https://developers.openai.com/plugins/plan/tools)
- [Shopify agentic commerce](https://shopify.dev/docs/agents)
- [Shopify Storefront MCP migration](https://shopify.dev/docs/apps/build/storefront-mcp)
- [ACP](https://developers.openai.com/commerce)
- [UCP](https://ucp.dev/)

These describe external contracts, not evidence of Baci certification, partner
admission or cross-platform availability.

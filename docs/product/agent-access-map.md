# Baci capabilities and agent access

Reviewed 23 October 2026 against source revision
`1d05c8fb24ec6be788ec50d370c3bdfa0e2fa0d3`. This is a navigation map, not
authorization or proof of current deployment. Check the current implementation,
live tool discovery and merchant entitlement before calling or claiming a tool.

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

The merchant connector's runtime and revision must be freshly verified before
use. Older R0 notes advertise unavailable inventory/analytics operations; current
R1 source exists, but source alone does not prove the deployed gateway version.

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

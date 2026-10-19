# Shared live cart: Baci implementation research

Date: 11 October 2026. Status: recommendation only; no implementation or deployment.

## Recommendation

Implement one authoritative, merchant-scoped server cart, keep local UI state for responsiveness, and use private Supabase Realtime Broadcast messages to tell linked clients to fetch the newest cart. Use ordinary authorized HTTPS requests for mutations. Realtime improves freshness; it must not be required for correctness.

This is advisable for ChatGPT → website → mobile continuity. It is a normal synchronized application design. Generative UI or streaming tokens are not required: the agent performs a structured cart operation, the server commits it, and clients render the resulting state.

Start with a bounded guest identity and tenant isolation spike, then web/MCP integration, then live notifications, then mobile. Do not attempt a general offline synchronization engine or custom WebSocket infrastructure initially.

Supabase recommends Broadcast for database change subscriptions that need scalability and security; Postgres Changes is simpler but has scaling limitations. [Official comparison](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes).

## What Baci has today

Reviewed source: task checkout `/Users/mac/.codex/worktrees/ogabassey-cart-release/Baci-app`, HEAD `ebfd7e6e7f749ba9de77b18462097ae5a1ed2910`; selected files also inspected at cached `origin/main` `3a546e0dafd74571da478a58a361c3ce42097691`. These are source observations, not a fresh production schema/deployment audit.

| Area | Observed behavior | Consequence |
| --- | --- | --- |
| Web cart | React state and merchant-scoped localStorage | Refresh restores local state, but it does not subscribe to the MCP cart |
| ChatGPT/MCP guest cart | Private PostgreSQL cart, capability token, expiry and version | Durable server storage already exists; browser membership does not |
| Website handoff | Imports selected products/quantities into the local cart | A transfer copies items; it does not bind both surfaces to one cart |
| Mobile storefront | Zustand persistence backed by MMKV/AsyncStorage | Local persistence is not cross-device synchronization |
| UCP agent carts | Separate merchant-scoped `agentic_cart_sessions` and lifecycle | Avoid creating another overlapping contract or merging protocols blindly |

Relevant source files:

- `apps/web/src/hooks/cart/storefront-cart-provider.tsx` and `cart-storage.ts`.
- `apps/web/src/components/storefront/ogabassey/pages/cart-page-wrapper.tsx`.
- `apps/web/mcp-server/guest-cart-store.ts`.
- `supabase/migrations/20261008230000_mcp_guest_carts.sql`.
- `apps/mobile-storefront/stores/cart-store.ts`, `partialize-cart-store.ts`, and `lib/storage.ts`.
- `supabase/migrations/20260526193000_add_ucp_cart_sessions.sql`.
- `apps/web/src/contexts/customer-auth-context.tsx` and `apps/web/src/app/api/storefront/auth/session/route.ts`.

The inspected MCP cart table has no explicit `merchant_id`. Its dedicated worker RPC boundary is private, but it is insufficient as the general multi-tenant browser cart boundary. Removing its last item currently deletes the cart and retires the token. A shared live cart needs an intentional empty-cart lifecycle so linked clients do not lose their identity after ordinary removal.

Existing line identity includes variants/options/condition; voucher restrictions, negotiated prices, and mobile checkout generation also need preservation. Replacing these stores with a generic product-ID-only cart would regress behavior.

## Delivery options

| Option | Benefits | Costs/limits | Recommendation |
| --- | --- | --- | --- |
| Current snapshot handoff | Lowest complexity; already tested | Open website cart stays independent after import | Keep during migration |
| Shared server cart + periodic/focus fetch | Straightforward recovery and debugging | Delayed updates; repeated reads | First integration step and fallback |
| Shared server cart + private Broadcast | Fast updates, existing Supabase stack, minimal events | Authorization, reconnect and connection billing | Preferred live transport |
| Direct Postgres Changes | Simple initial subscription | Row exposure and scaling considerations; existing capability row unsafe to broadcast | Do not use raw MCP rows |
| Custom SSE service | One-way updates fit cart notifications | Persistent connection operations and separate mobile integration | Reserve if guest Broadcast authorization proves unsuitable |
| Full offline/CRDT synchronization | Rich offline collaboration | Major conflict/lifecycle complexity with little initial benefit | Defer |

SSE can provide one-way server notifications while mutations remain HTTP requests. It does not remove identity or tenant authorization requirements. [MDN SSE guidance](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).

## Intended shopper flow

1. A shopper can use ChatGPT without an Ogabassey account. The server creates a guest cart under the merchant bound to that MCP connection.
2. The handoff opens the merchant website and offers to connect that browser to the cart. Exchange a short-lived grant for a host-only Secure, HttpOnly session cookie. Strip the grant from the URL.
3. The browser now reads and changes the same cart as ChatGPT. While the page is open, a committed agent change triggers a notification and the cart updates automatically.
4. Mobile joins the same cart through a verified app handoff or customer sign-in. A different unlinked device cannot automatically discover a guest cart.
5. Account creation and saving customer details remain optional and explicit. A save-details checkbox must not silently establish account ownership or authenticate by email alone.

Custom merchant domains do not share one browser cookie. Linking must occur on each intended domain/device, or through authenticated customer identity.

The pairing grant should be bound to the cart, merchant and destination, expire quickly and be single-use. Redemption should require an intentional action/POST; GETs and link previews must not consume it. Persistent cart write credentials must not appear in URLs, logs, analytics or referrers. Native credentials belong in secure device storage, not the ordinary cart persistence store.

When the website already has items, present a clear preserve/merge choice. Linking must not silently overwrite that cart. A merge needs deterministic variant-aware rules and idempotency; revisiting a handoff must not increment quantities repeatedly. Once linked, website additions can also become visible to ChatGPT: make that shared scope understandable.

## Guest identity: resolve before implementation

Preferred boundary: a guest session broker with a protected browser cookie, narrow server cart permissions, and short-lived cart-specific receive permissions for Broadcast. Browsers must never receive worker credentials or a broadly privileged JWT. The exact Supabase principal/claim/grant arrangement needs an isolated compatibility test.

Supabase anonymous Auth is an alternative, not a drop-in change. Anonymous users use the authenticated role; they require careful RLS treatment, abuse controls and lifecycle cleanup. Baci's current storefront session route creates/loads customer profiles for authenticated users, so anonymous cart identity must not accidentally enter that account flow. [Anonymous Auth documentation](https://supabase.com/docs/guides/auth/auth-anonymous).

Do not reuse the existing server-only agent checkout JWT as a browser identity: its authority and subject semantics differ. Do not introduce a service-role client for shopper operations. If scoped guest Broadcast cannot be demonstrated safely, ship the shared server cart with focus/periodic fetch first while resolving transport authorization.

## Multi-tenant data and authorization

Suggested conceptual model:

- `carts`: cart ID, merchant ID, owner/session reference, lifecycle state, version, expiry.
- `cart_items`: cart ID, merchant ID, product/variant identity, quantity and applicable negotiation/voucher references.
- `cart_access`: bounded guest/device/customer membership, expiry and revocation.
- `cart_operations`: idempotency key and mutation outcome scoped to merchant and cart.

Use append-only migrations. Whether to evolve the current MCP tables or add a shared model requires checking UCP/MCP compatibility; do not create two authoritative carts for the same linked session.

Enforce merchant matching in the database and RPC authorization, including product and variant ownership. Resolve tenants through trusted merchant domains, verified account context or bound MCP configuration; never trust a body-selected merchant alone.

A topic such as `cart:<merchant_id>:<cart_id>` is a routing address, not an authorization control. Private channel membership must be checked independently. No merchant-wide cart channel. Cache/query/storage keys must include merchant, cart and session identity, and be cleared on identity changes.

Supabase controls private channel access with RLS on `realtime.messages`. Policies can distinguish receiving from sending; shopper clients should receive server notifications without permission to publish authoritative events. Authorization is cached until token refresh/expiry, so revocation needs short token lifetimes and explicit reconnect/recheck handling. [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).

Broadcast only an invalidation such as cart ID/version/operation ID. Do not emit full capability-bearing rows, customer details or credentials. Snapshot fetches and every mutation independently reauthorize access. Private cart HTTP responses use `Cache-Control: private, no-store`.

## Correctness and reconnects

- Atomically commit each cart mutation, increment its version and enforce an idempotency key. A timed-out request is reconciled before retrying.
- Preserve variant-aware line identity. Decide increment versus absolute quantity semantics explicitly.
- Reject/reconcile stale same-line edits; do not silently overwrite a newer removal or quantity from another device.
- Subscribe, fetch a consistent cart snapshot, and refetch when a newer event arrives. Coalesce notifications and ignore duplicate/older versions.
- Fetch again on reconnect, foreground/focus and session refresh. Notifications can be missed; the database remains authoritative.
- Publish notifications through a database transaction-aware mechanism or transactional outbox, not a fragile app write-then-send sequence.
- Keep optimistic local feedback with visible pending state and rollback on failure. Defer a general offline mutation queue.
- Retain a stable empty cart until explicit expiry/closure. Distinguish ordinary emptying from checkout completion and start a new cart generation after completion.
- At checkout, validate prices, availability, quantities and applicable offers server-side. If another surface changes the cart during checkout, refresh/review the summary before the order is created.

Mobile should subscribe while active and fetch again on resume. Continuous updates while the app is backgrounded are not guaranteed. [React Native AppState](https://reactnative.dev/docs/appstate).

This design does not guarantee ChatGPT's conversation or widget will repaint spontaneously. Web/mobile live delivery and ChatGPT tool/widget refresh are separate surfaces. Validate supported ChatGPT behavior separately; accurate reads and mutation responses must always work.

## SEO and performance

There is no inherent SEO penalty or ranking benefit from a server cart. The main risks are making public pages depend on private sessions, increasing JavaScript work and introducing layout shifts.

- Keep product/category HTML, crawlable links and product structured data server-rendered and cacheable.
- Isolate the cart badge/drawer as a client feature. Do not wait for cart authentication or a socket to render the public catalog.
- Avoid reading guest cookies in the public root layout simply to show a badge. Next.js cookie reads can change rendering/cache behavior; verify the exact project configuration before adding them. [Next.js cookies](https://nextjs.org/docs/app/api-reference/functions/cookies).
- Load subscriptions only when there is an active linked cart; use stable badge dimensions and preserve existing idle/deferred cart validation.
- Keep cart/checkout/handoff content private and nonindexable, exclude it from sitemaps, and avoid session-bearing internal links. Google must be able to read a `noindex` directive for it to work; robots blocking alone is not a deindexing guarantee. [Google noindex guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing).
- Avoid ephemeral session parameters in public catalog URLs. [Google ecommerce URL guidance](https://developers.google.com/search/docs/specialty/ecommerce/designing-a-url-structure-for-ecommerce-sites).
- Compare LCP, INP and CLS before/after. Core Web Vitals matter to Search, but good scores do not guarantee rankings. [Google Core Web Vitals guidance](https://developers.google.com/search/docs/appearance/core-web-vitals).

Existing robots configuration was inspected; rendered cart/checkout metadata and production caching were not fully audited in this research. Do not infer current indexing status from the source alone.

## Pros, cons and cost

| Benefit | Tradeoff |
| --- | --- |
| Agent and storefront share one accurate cart | Guest linking and account merge must be designed carefully |
| Open clients update without page refresh | Reconnects, stale versions and failure recovery need coverage |
| Consistent web/mobile/agent operations | Migration touches three client adapters and existing cart rules |
| Tenant policies centralize isolation | Incorrect membership/grants could expose another shopper's cart |
| Local optimistic UI remains fast | Network failures require pending/error states |

The operational cost is driven by active connections, message fanout and snapshot reads, not just stored cart rows. Reuse connections, disconnect idle clients and coalesce updates.

Current documented Pro allowances are 5 million messages and 500 peak connections, with overages of $2.50 per million messages and $10 per 1,000 peak connections. Actual project plan, limits, spend cap and workload have not been checked, so this is not a cost quotation. [Supabase Realtime pricing](https://supabase.com/docs/guides/realtime/pricing).

## Delivery and acceptance gates

1. **Identity/tenant spike:** demonstrate guest pairing, private receive authorization, credential expiry and isolation between two merchants and two guests. Audit interaction with existing customer/merchant authentication.
2. **Shared cart foundation:** web and MCP use one contract; preserve local cart import, vouchers, negotiation and empty-cart behavior. Ship fetch fallback first.
3. **Realtime pilot:** add minimal private notifications, reconnect recovery and performance measurements for Ogabassey.
4. **Mobile/account continuity:** secure app pairing, foreground recovery and explicit authenticated merge. Then expand to other tenants.

Required regression scenarios:

- ChatGPT adds two variants; web shows exact quantities; remove one; only remaining lines reach checkout.
- Web and ChatGPT edit the same line concurrently; stale actions cannot resurrect it.
- Duplicate mutation/handoff, dropped event, offline client and reconnect converge without duplicated quantity.
- Removing the last item empties every linked view without breaking future additions.
- Cross-merchant product/cart IDs and another guest's topic/session are denied.
- Expired/revoked grants cannot mutate; event payloads contain no secrets or personal data.
- Login/logout, custom-domain switching and guest/account merge preserve the intended cart.
- Voucher and negotiated-price rules remain intact; completed checkout generations cannot be revived.
- Public product rendering/cache behavior and measured Core Web Vitals do not regress.

Acceptance should include convergence latency and join failures, peak sockets/messages, database read rate, mutation conflicts, cart/checkout consistency and negative isolation tests. Set numerical targets after measuring a pilot baseline. No production load or SEO benchmark was run for this report.

## Decision

Proceed with the shared server cart architecture in phases. Multi-tenancy makes identity and authorization more involved, but it does not require separate infrastructure per merchant. Private per-cart membership, tenant constraints, versioned writes and reconnect snapshots make the design manageable. The first implementation decision is the guest identity boundary; the transport comes after that proof.

## Shopify comparison: additional research before starting

Reviewed official Shopify documentation on 11 October 2026. This describes public contracts, not Shopify's internal database or synchronization infrastructure.

### What Shopify documents

1. **Server cart and checkout continuity.** The Storefront API creates a cart, operates on its lines and exposes a checkout URL. Full cart IDs include a secret required for mutations and private buyer details; Shopify explicitly treats that secret as confidential. Request a fresh checkout URL when the shopper is ready rather than persisting it indefinitely. [Cart management](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage).
2. **Buyer identity is separate from cart contents.** Hydrogen attaches customer identity when a shopper logs in and updates country context for pricing. This supports a guest-first flow with later authenticated association, not an account prerequisite. [Buyer identity](https://shopify.dev/docs/storefronts/headless/hydrogen/cart/buyer-identity).
3. **Fast UI is optimistic.** Hydrogen overlays pending cart operations onto server data, marks optimistic lines and reconciles with the server response. Its example disables operations on an unconfirmed optimistic line. [useOptimisticCart](https://shopify.dev/docs/api/hydrogen/latest/hooks/useoptimisticcart).
4. **Line identity matters.** Shopify's Ajax documentation recommends a line key when multiple lines share a variant ID. Those keys can change when properties/discounts change, so clients must consume current server identities. Clearing a cart returns an empty cart while preserving its attributes and note. [Ajax Cart API](https://shopify.dev/docs/api/ajax/reference/cart).
5. **Warnings differ from failures.** A mutation can complete and return non-blocking warnings with a code, message and affected resource. [CartWarning](https://shopify.dev/docs/api/storefront/latest/objects/CartWarning).
6. **Concurrent requests need explicit treatment.** Shopify corrected dropped concurrent operations in 2025. Excess simultaneous requests can return HTTP 409 or a GraphQL CONFLICT. This is evidence that concurrency is a real cart correctness concern, not a reason to assume Shopify solves every stale-client race for applications. [Concurrency changelog](https://shopify.dev/changelog/posts/improved-concurrency-handling-in-the-cart-ajax-api-and-storefront-cart-graphql-api).
7. **Cart totals are estimates.** Cart costs can change at checkout; buyer context influences pricing. [Cart query](https://shopify.dev/docs/api/storefront/latest/queries/cart).
8. **Clients persist the returned identity.** Hydrogen's mutation handler updates the stored cart ID after each mutation because it can change. [Hydrogen cart management](https://shopify.dev/docs/storefronts/headless/hydrogen/cart/manage).

Shopify offers Ajax carts for online-store sessions and Storefront API carts for headless clients. Their existence is not proof that independently created carts, channels or devices automatically share one cart. The inspected guides describe HTTP mutations and reads with local optimistic feedback; they do not promise push synchronization to every linked device. Baci's realtime layer remains a separate, explicit requirement.

### Changes to incorporate into Baci's design

| Lesson | Proposed Baci contract |
| --- | --- |
| Precise line targeting | Stable server line IDs; the agent resolves “remove the charger” against current lines, asking only when ambiguous |
| Complete mutation reconciliation | Return an authoritative cart snapshot, version, operation ID, safe errors and warnings |
| Pending line behavior | Distinguish temporary optimistic IDs from confirmed line IDs; reconcile queued actions safely |
| Guest/customer separation | Attach authenticated identity intentionally; detach/revoke it on logout without exposing the previous shopper's cart |
| Fresh checkout transition | Prepare checkout from the current authorized cart; validate current price, availability and offers |
| Explicit conflict response | Handle stale versions and duplicate requests independently; no blanket retry of an uncertain increment |
| Empty cart remains a cart | Ordinary clearing preserves linked session identity; expiry/completed checkout closes the lifecycle separately |
| Opaque, changeable credentials | Keep internal cart ID separate from rotatable access grants; clients accept updated session credentials |

These are Baci design recommendations inferred from Shopify's public patterns. Shopify does not document our proposed database version/idempotency/outbox arrangement, and those should not be attributed to Shopify.

### What to avoid copying

- A Shopify cart ID's secret/query format is not a template for Baci's shareable handoff URLs. Keep persistent write credentials behind the server session boundary.
- A UI property labelled private is not a substitute for authorization. Sensitive data needs actual access controls.
- Do not adopt Hydrogen or GraphQL merely to reproduce these patterns; they fit Baci's existing Next.js, Expo, Supabase and MCP stack.
- Do not infer automatic guest cart discovery from a shared customer email, or automatic cross-channel merging from a customer login.
- Shopify's API endpoint is scoped to a shop. Baci's shared database must enforce equivalent merchant boundaries explicitly, alongside shopper membership.

### Updated recommendation

Keep the shared server cart plus private notification design. Before building subscriptions, specify the cart service's mutation response, line IDs, guest/customer lifecycle, warnings, checkout transition and conflict rules. These contracts are the most useful additional lessons from Shopify; realtime delivers their state across linked clients.

## Google Universal Cart and UCP: additional learnings

Research date: 11 October 2026. Preserve guest checkout, merchant isolation and the previously proposed ChatGPT/web/mobile synchronization. This section adds interoperability requirements; it does not authorize Google onboarding, agent payments or implementation.

### Identify the announcement and its actual integration contract

The likely announcement is Google's **Universal Cart**, announced on 19 May 2026. Google described a shopping hub spanning merchants and Google surfaces such as Search, Gemini, YouTube and Gmail, with either native purchase or transfer to merchant sites. The announcement described staged rollout, initially in the US; it does not establish Nigerian availability or Ogabassey eligibility today. [Google announcement](https://blog.google/products-and-platforms/products/shopping/google-shopping-cart/).

Two related pieces must be distinguished:

- **Universal Cart:** Google's consumer-facing product.
- **Universal Commerce Protocol (UCP):** the open commerce contract that businesses and platforms can implement.

Google's merchant guide, updated 9 October 2026, describes a **one-way cart transfer**. Its initial integration supports CreateCart, not updating, deleting or synchronizing the merchant cart back to Google. Cart transfer does not require native checkout, payment handlers or order APIs. [Google Cart API overview](https://developers.google.com/merchant/ucp/guides/overview/cart-overview).

Google accumulates items on its side and sends the full item list in one `POST /carts` when the shopper clicks the transfer action. The merchant returns the initialized cart and `continue_url`. This is different from pushing every agent edit to an already-linked merchant cart. [Google Cart API implementation](https://developers.google.com/merchant/ucp/implementation/2026-04-08/cart-api).

The broader current UCP cart specification supports create/read/update/cancel operations and separates carts from checkout. Checkout conversion through `cart_id` uses the cart's contents, reuses an existing incomplete checkout and links the lifecycle. Its update operation replaces the entire resource, which matters when multiple clients edit. [UCP cart capability](https://ucp.dev/specification/shopping/cart/).

### Architecture addition: adapters over one cart service

Suggested responsibility boundaries:

```
ChatGPT MCP tools ──────┐
Web and mobile APIs ────┼── authorized cart service ── tenant-scoped database
UCP REST/MCP adapters ──┘                │
                                        └── private change notifications
Google transfer ── UCP CreateCart adapter ── secure browser continuation
```

Keep Google imports and linked live carts as explicit modes:

| Mode | Expected behavior |
| --- | --- |
| Google transfer | Import the exact requested items into a merchant cart once; return a safe continuation link |
| Linked ChatGPT/web/app session | Every authorized mutation changes the shared cart; linked active clients receive notifications |
| Optional account linking | Authenticated, consented association enables saved data and cross-device recovery |

Do not label Google transfer as two-way synchronization. Do not assume Google UCP support automatically connects a ChatGPT app. Platform adapters require their respective contracts and enrollment independently.

### Guest access and merchant isolation

UCP distinguishes public access, agent-authenticated guest operations and user-authenticated account features. Identity linking upgrades the experience rather than making it a prerequisite for all commerce. OAuth Authorization Code with PKCE is specified for account linking, and public/native clients must not embed platform secrets. [Versioned identity-linking contract](https://ucp.dev/2026-04-08/specification/identity-linking/).

Baci recommendations:

- Keep guest cart and guest checkout available. A shopper's Google or ChatGPT account is not automatically a Baci merchant-customer identity.
- Authenticate the calling platform where required, then separately authorize its access to this particular cart. Platform credentials alone must not grant access to every shopper or merchant.
- Bind each external item/offer identifier to the resolved merchant and exact variant. Recalculate prices and availability using Baci's authoritative catalog.
- Resolve the merchant from trusted host/profile/registered platform context. Verify a continuation URL belongs to that merchant's approved domain; reject mixed-merchant payloads rather than blending them into one checkout.
- Store source/platform cart references and operation identifiers under tenant scope. External IDs, request IDs and tracking metadata confer no ownership.
- If a future UI aggregates several merchants, keep separate merchant carts, totals, policies and checkout sessions behind that UI. This research recommends no combined multi-merchant payment.
- Offer an explicit merge choice when a browser already has a cart. Import retries, repeated links and previews must not duplicate quantities or silently replace unrelated items.

### Protocol details worth planning now

The current UCP REST binding advertises capabilities through `/.well-known/ucp`, defines request tracing and idempotency, and separates protocol errors from business outcomes. Matching retry keys replay the stored result; mismatched bodies produce a conflict. [REST binding](https://ucp.dev/specification/shopping/cart/rest/).

The MCP binding provides standard create/get/update/cancel tools and structured cart responses. Transport adapters should map those operations into the same cart authorization and business rules rather than maintaining separate storage. [MCP binding](https://ucp.dev/specification/shopping/cart/mcp/).

Add these requirements to the design:

1. **Version and capability negotiation.** Pin each adapter to the version supported by its platform. Google's reviewed integration uses `2026-04-08`; the current general UCP examples use `2026-08-25`. Do not switch version strings without schema, semantics and conformance changes.
2. **Retry identity and provenance.** Keep an idempotency key plus request fingerprint/result for the documented retention window. Scope it by tenant, caller and operation. Keep tracing free of credentials and unnecessary personal data.
3. **Safe full replacement.** UCP replacement must not overwrite newer web/app edits. Establish a supported precondition, scoped session ownership or explicit conflict/reconciliation strategy for each negotiated adapter. An internal cart version is useful, but external clients cannot be assumed to send an undocumented field.
4. **Structured outcomes.** Check protocol status and business messages, not HTTP 200 alone. Preserve line-specific failures, expiry and human continuation choices.
5. **Consent and authority separation.** Saving details, receiving marketing, account linking, modifying a cart and paying are distinct permissions. Never interpret add-to-cart as purchase authorization.
6. **Catalog identity mapping.** Define stable merchant/offer/variant mappings shared by feeds and commerce APIs. Localization signals influence estimates; they must not choose a different tenant or grant identity.
7. **Continuation safety.** Use a short-lived handoff grant with explicit redemption, URL cleanup and correct browser/app destination. The continuation link must not expose the persistent cart mutation credential.
8. **Capability-specific readiness.** Cart-only transfers should have their own readiness gates rather than require native payment/order capabilities that their platform contract does not need.

### Baci already has related source

At the previously recorded cached main snapshot, Baci already contains UCP cart routes, response adapters, discovery and a universal-cart readiness checker. Relevant files:

- `apps/web/src/app/api/agentic/carts/`.
- `apps/web/src/lib/agentic/ucp-cart-response.ts`.
- `apps/web/src/lib/agentic/ucp-shopping-profile.ts`.
- `apps/web/src/lib/agentic/ucp-profile-constants.ts` (version `2026-04-08`).
- `apps/web/src/lib/agentic/universal-cart-readiness.ts`.

The inspected profile builder ties cart advertisement to checkout capabilities/links, and the readiness checker includes payment/order checks. This is an implementation-planning concern for Google's cart-only path, not a proven production integration failure. Reconcile existing UCP cart ownership/storage with the shared-cart foundation instead of adding a duplicate third system. Source inspection does not establish Google approval, live conformance or customer availability.

### What to include now versus later

**Include in the shared-cart design now:** protocol-neutral cart service; tenant/offer identity mapping; distinct transfer and linked-session modes; idempotency; structured outcomes; safe human handoff; guest/account permission separation; versioned adapters and contract tests.

**Later, as separate work:** Google eligibility/onboarding and end-to-end interoperability verification, broader UCP version adoption, embedded agent UI, loyalty/price monitoring, and AP2 agent payments. These are not prerequisites for a safe guest cart or our requested live web/mobile updates.

### Additional acceptance cases

- Two Google transfer retries create one intended cart/result; different bodies cannot reuse the same key.
- A payload containing another merchant's offer is denied, including on custom domains.
- Agent-authenticated guest access cannot retrieve saved addresses or unrelated carts.
- A stale full-cart replacement cannot resurrect a line removed on web/mobile.
- Cart-only capability discovery works without advertising unsupported payments.
- A business error inside an HTTP-success response is correctly surfaced to the shopper.
- Expired handoffs recover safely; existing browser items are preserved or merged only by the intended flow.
- Cart-to-checkout conversion reuses the correct active session, and the shopper still explicitly authorizes the purchase.

**Conclusion:** Google's work reinforces the proposed architecture and adds a useful interoperability boundary. Build one safe merchant-scoped cart service, attach platform adapters, preserve guest checkout, and promise live synchronization only on surfaces we actually link and verify.

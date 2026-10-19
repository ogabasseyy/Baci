# Shared Server Cart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve guest checkout while giving linked ChatGPT, web and mobile sessions one durable cart per merchant, with secure handoff, reliable live updates and compatible UCP cart transfers.

**Architecture:** PostgreSQL owns cart state; a tenant-aware cart service applies authorized, versioned, idempotent commands. Web, mobile, MCP and UCP are adapters over that service; private Supabase Broadcast notifications prompt snapshot reads, with foreground polling and reconnect recovery. Google cart transfer is an import flow, while explicitly linked Baci clients share ongoing state.

**Tech Stack:** Existing TypeScript, Next.js, Expo, React Context/Zustand, Supabase/PostgreSQL, pnpm/Turborepo, Biome, Vitest, Jest and the repository's browser/SQL test harnesses. No additional synchronization framework is planned.

**Spec:** [Shared cart design and Shopify/Google research](../specs/2026-10-11-shared-server-cart-design.md).

**Status:** Revised after a second code-backed review on 11 October 2026; implementation, production migration, credentials, deployment and external platform enrollment have not started. New paths and names below are proposed interfaces; existing paths were inspected at the source snapshots recorded in the spec. Refresh them against main at execution start. The local authorization proof remains an execution gate, not an already proven capability.

## Global Constraints

- Guest cart and guest checkout remain available without a customer account. Saving details, account linking, marketing consent and purchase authorization remain separate choices.
- One cart belongs to exactly one merchant. Every line, grant, operation, checkout reference and event must match that merchant.
- Read/write cart access requires shopper/session authority as well as a trusted merchant context. Knowing a cart UUID or having platform credentials alone is insufficient.
- A browser/app joins an existing guest cart through an explicit secure handoff. Unlinked devices do not discover guest carts by matching email addresses.
- No admin/service-role client for shopper operations. Existing legacy exceptions do not authorize this work; never reuse the server-only agent checkout JWT as a browser identity.
- Do not change `.env*`, `apps/web/src/proxy.ts` or `apps/web/src/config/business-types.ts` without the explicit authorization required by repository instructions. Prepare any required change for review before seeking that authorization.
- Append migrations; preserve old rows and tokens during compatibility rollout. No destructive table cleanup in the initial release.
- Preserve variant/condition/options identity, voucher rules, negotiated-price invalidation, quantity limits, credit context and checkout generation behavior.
- Keep public product/category rendering and caching independent of guest cart sessions and realtime connections. Private snapshots must not enter public CDN caches.
- Google transfer support does not imply bidirectional Google sync, Google availability or ChatGPT distribution approval. Pin negotiated protocol versions; do not advertise unsupported capabilities.
- ChatGPT tool calls read the current shared cart; previous messages and inactive tool cards are not live views. An active app widget may refresh only through supported host APIs, verified separately. The initial live-update guarantee applies to linked, active Baci web/mobile surfaces.
- No orders, payments or shipments during live QA. Use test fixtures and stop live checkout at the final review summary.
- Production release is a separate authorized gate using the current approved VPS flow. Earlier release-specific build or credential exceptions are not blanket approval for this release.
- Use the user-supplied current AGENTS.md over stale generated guidance in historical release checkouts. Native changes require the current mobile-storefront instructions.

## Review Focus

- A preview crawler opens a handoff before the shopper: GET must not redeem it; Task 6 tests preview, replay and ambiguous POST outcomes.
- A response arrives after logout or merchant switching: it must not repopulate the previous cart; Tasks 7–10 test session-generation fencing.
- An external full-cart update arrives after a website removal: it must not resurrect the line; Tasks 3 and 12 test stale replacements and ownership transitions.
- A mutation commits but its HTTP response/event is lost: retry must reconcile without duplicate quantity; Tasks 3 and 8 test replay and event gaps.
- A rollout is disabled after a cart has migrated: it must not fall back to an older independent local/legacy cart; Tasks 4 and 14 test routing and rollback.

---

## Delivery sequence and review units

| PR-sized phase | Tasks | Independently verifiable outcome |
| --- | --- | --- |
| A. Contracts and authorization | 1–2 | Local tenant/guest isolation proof and additive schema; no traffic switched |
| B. Authoritative cart service | 3–4 | Transactional commands and recoverable legacy migration |
| C. Web and ChatGPT continuity | 5–7, 11A | Guest handoff and checkout use the same cart with fetch recovery |
| D. Live updates | 8 | Linked active clients converge without refreshing the page |
| E. Mobile and optional accounts | 9–10, 11B | Secure mobile pairing, checkout binding and intentional authenticated continuity |
| F. UCP interoperability | 12 | Existing UCP adapters use the core; Google-style transfer contract passes |
| G. Release qualification | 13–14 | Cross-surface, tenant, performance and operational evidence |

Implement in dependency order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 11A → 8 → 9 → 10 → 11B → 12 → 13 → 14. Task 11A is the server/web checkout boundary; Task 11B adds the native adapter after Task 9. Task 4 prepares UCP migration support, but does not activate it before Task 12's replacement/version guards pass.

Create disabled enrollment flags, bounded retention/cleanup and minimum metrics in Tasks 2–4; Task 14 qualifies and operates them rather than adding these safeguards after traffic switches. For a staged pilot, apply Tasks 13–14 to that phase's entire dependency set before activation; the final full-surface matrix is still required. Never migrate a cart while an unfenced legacy writer can change it. Do not release an incomplete phase merely because an earlier PR merged.

## Decisions fixed by this plan

### Identity and session proof

- Guest cart identity is independent of Supabase customer/merchant Auth. Do not call anonymous sign-in on catalog page load or replace an existing customer session.
- Preferred implementation: a cart session broker issues a signed session proof bound to `merchantId`, `cartId`, `grantId` and a random guest principal. Web stores it in a Secure, HttpOnly, SameSite=Lax host-only cookie; native stores it using the existing secure-storage abstraction in its own namespace.
- On a shared storefront host, namespace cookies/session selection by the resolved merchant, not just hostname; test two merchants in separate tabs. Bind proofs to environment and audience as well as merchant/grant, pin accepted algorithms/issuer, and rotate/renew proofs without renewing an expired or revoked grant. Cookie/native proof expiry must agree with the grant lifecycle; a mutation in one linked session must not silently invalidate another session's valid proof.
- The broker verifies that proof, resolves the merchant independently and creates a short-lived RLS client with a dedicated cart role. Its signed claims are generated server-side from verified context, never copied from request JSON. No broad `authenticated` role inherited solely for convenience.
- A separate receive-only cart role/token permits joining exactly the authorized private realtime topic. It has no catalog-private, customer, payment, order or cart mutation privileges.
- Prototype these role/token paths against a local Supabase stack in Task 2. Failure to prove isolation blocks activation of the affected path. A realtime limitation permits a fetch-only pilot; failure of the cart authorization proof blocks the cart pilot itself.
- Proposed product defaults: cart/grant idle expiry 7 days, renewed on successful authorized mutations; reads/polls do not keep abandoned carts alive. Handoff grant expiry 5 minutes; API/realtime scoped token lifetime at most 5 minutes; idempotency records retained at least 24 hours. Add a tested scheduled cleanup job; never rely on automatic expiry cleanup.
- Signing material must remain server-only. Use the existing signing infrastructure only after confirming its accepted algorithm/key and role boundary in the spike. Additional signing keys/environment provisioning require the repository's explicit environment approval before activation.
- The standalone MCP worker must retain a narrowly scoped cart capability; do not distribute the project-wide JWT signing key to that process as a shortcut. Prove its capability-validation/RPC boundary separately from the web broker. Outbox publishing and cleanup use dedicated internal grants unavailable to shopper or receive-only tokens.

### Data, commands and responses

Create a dedicated canonical cart model, and convert existing MCP/UCP stores to adapters and legacy-reference mappings. A migrated cart has one writer/store; no ongoing dual writes.

| Table | Responsibility and constraints |
| --- | --- |
| `commerce_carts` | UUID, merchant, currency, version, lifecycle, expiry and active checkout reference; unique `(merchant_id,id)` |
| `commerce_cart_lines` | Stable line UUID, cart/merchant, product/variant/condition/options, quantity and validated offer references; composite cart FK plus tenant-safe product/variant constraints |
| `commerce_cart_grants` | Guest/device/customer/platform grant, permitted cart operations, principal, expiry/revocation; no customer PII required for guest use |
| `commerce_cart_operations` | Unique `(merchant_id,cart_id,principal_id,operation_id)`, request digest and committed result; matching retries replay, mismatched reuse conflicts |
| `commerce_cart_creation_requests` | Unique `(merchant_id,principal_id,operation_id)` before a cart ID exists; request digest, cart/grant reference and retry receipt for creation/import |
| `commerce_cart_handoffs` | Hashed single-use grant, source cart, intended destination and bounded redemption receipt; raw secrets never persisted/logged |
| `commerce_cart_legacy_refs` | Tenant/provider/hashed legacy reference → canonical cart; unique mapping and import receipt |
| `commerce_cart_events` | Transactional minimal event/outbox records keyed by cart/version, expiry and delivery progress; bounded delivery leases, retries and retention |

All tables require RLS, explicit grants, indexed foreign keys and expiry/revocation checks. Internal history/operation results remain inaccessible to unrelated callers. Merchant authority is checked inside database operations as well as the route layer.

Shared pure contracts belong under `packages/shared/src/cart/`; web request Zod schemas belong under `apps/web/src/schemas/`. The contracts define:

```ts
type CartSource = 'web' | 'mobile' | 'mcp' | 'ucp';
type CartState = 'active' | 'checkout' | 'completed' | 'expired' | 'canceled';
type CartCommand =
  | { type: 'add'; item: CartItemIdentity; quantity: number }
  | { type: 'set_quantity'; lineId: string; quantity: number }
  | { type: 'remove'; lineId: string }
  | { type: 'clear' }
  | { type: 'replace'; lines: CartInputLine[] };
type CartMutationInput = {
  operationId: string; expectedVersion: number; command: CartCommand;
};
type CartResult =
  | { ok: true; cart: CartSnapshot; operationId: string; replayed: boolean; warnings: CartWarning[] }
  | { ok: false; code: CartErrorCode; cart?: CartSnapshot };
```

`CartItemIdentity` contains product ID, optional variant ID, condition and normalized options; quantity is a positive integer within existing catalog/cart limits. `CartInputLine` contains that identity plus quantity. `CartSnapshot` contains cart/merchant IDs, state, integer version, stable lines, currency, integer amounts in currency minor units, estimated-total flags and expiry; it contains no access credential or private buyer record. `CartWarning` has code, safe message and optional line ID. `CartErrorCode` includes `unauthorized`, `not_found`, `expired`, `version_conflict`, `idempotency_conflict`, `invalid_item`, `cart_locked`, `refresh_required`, `temporarily_unavailable` and `rate_limited`.

`CreateCartInput` contains `operationId`, optional initial `CartInputLine[]` and an allowlisted currency/context; the transport supplies the source and verified principal rather than trusting shopper fields. First creation atomically inserts the cart, its initial grant and the operation receipt. `VerifiedCartSession` contains merchant/cart/grant/principal IDs, allowed operations and expiry; possession of decoded claims is insufficient without signature and current database-grant validation. `CartCheckoutSnapshot` contains the confirmed cart version/lines, validated estimates, safe warnings and checkout session ID/expiry, with no reusable cart credential.

Before tokenless creation, establish a stable anonymous bootstrap proof and a client-retained random operation ID; the response containing the new cart is not the first durable retry identity. Browser bootstrap is an explicit first-cart-action POST with no cart side effect; native stores its proof securely. Concurrent first actions share that bootstrap identity. MCP/platform adapters need an equivalent caller boundary plus a stable, unguessable per-shopping-session operation key, not an IP address or shared MCP connection as shopper identity. Do not assume ChatGPT exposes a verified shopper ID. Bootstrap, creation and external import receipts enforce the same tenant and caller scope; absent stable retry identity, do not claim exactly-once creation or enable shared-cart enrollment for that caller.

- `add` increments; `set_quantity` sets an absolute positive quantity; `remove` and `clear` are explicit operations. Preserve old MCP absolute-quantity semantics through its adapter.
- Every new external mutation requires a fresh operation ID and observed version. A repeated operation replays before version evaluation. A stale different operation receives a conflict and current authorized snapshot; never silently rebase user intent.
- Replay the committed operation outcome, but never downgrade a client's newer snapshot to the older replayed version. Fetch current state separately when necessary. Enforce duplicate-operation serialization in the database: concurrent requests with the same key wait/recheck the receipt; the loser must return a replay, not execute again or expose a unique-constraint error. Keep a digest/tombstone for the active cart lifetime when full replay bodies are pruned, so a late retry cannot become a new add.
- Removing a line that is already absent, with a current version, is a successful no-op. Clearing an empty cart is also a no-op. Ordinary emptying retains the active cart/grants.
- Removal, clearing and quantity reduction must remain possible when an existing product is delisted, stock/price validation fails or the catalog is temporarily unavailable. Authorize/version-check these actions and return safe stale-total warnings; revalidate affected additions/increases, and fully revalidate at checkout. Never make unrelated invalid survivors block removal. Ordinary cart mutations do not reserve inventory.
- A stale UCP replacement without a negotiated precondition must not write to a cart concurrently owned by a linked web/app session. Task 12 defines an ownership transfer boundary and continuation response.
- Merge rule: after explicit shopper choice, union distinct line identities and use the maximum quantity for the same identity; show the resulting quantities. Never sum automatically on repeated import. Incompatible voucher/negotiation contexts block merge with a clear choice; never silently drop them.
- For handoff merge, the incoming cart is the canonical destination so its originating ChatGPT session remains attached. Lock both carts in deterministic ID order and validate both versions. Merge only a destination-browser cart whose grants belong solely to that device/verified customer; if it is shared with other principals or has an active checkout, offer separate carts instead. Record the old-to-new mapping and retire its writer atomically without copying unrelated grants. Explain that the incoming cart's existing linked clients will see the merged items. `connect` switches this device's selected cart while preserving the previous cart; `keep_existing` leaves both intact.
- Session identity changes increment a local generation. Responses/subscriptions from older generations are discarded even if they contain a numerically newer cart version.
- Serialize local sends per cart while allowing a responsive pending UI. Retry an ambiguous request with its original operation ID/body/version before sending dependent commands. A proven conflict needs refreshed intent; do not silently discard another device's changes. Distinguish auth failure, expiry and temporary storage/network failure—an outage never means “create a replacement cart.”

## Task 1: Establish the baseline and shared contract

**Files:** Create `packages/shared/src/cart/{types.ts,line-identity.ts,commands.ts,index.ts}` and colocated `.test.ts` files; modify `packages/shared/package.json` to export `./cart`; create `docs/architecture/shared-cart-contract.md`.

**Interfaces:** Produces `CartSnapshot`, `CartItemIdentity`, `CartInputLine`, `CreateCartInput`, `CartMutationInput`, `CartResult`, `CartWarning`, `CartErrorCode`, `CartCheckoutSnapshot`, `CartChangeEvent` and `cartLineIdentity(item: CartItemIdentity): string`. The event contains only merchant/cart ID, committed version and operation ID.

- [ ] Refresh main, read current app instructions and inspect the existing MCP, UCP, web and native carts; record current paths, limits, grants and route protection in the contract document. Preserve dirty and peer-owned worktrees; use an isolated execution branch `codex/shared-server-cart`.
- [ ] Write `line-identity.test.ts`: same product with different variant, condition or options stays distinct; normalized option ordering matches; foreign/unknown option values do not gain validity through normalization.
- [ ] Run `pnpm --filter @baci/shared exec vitest run src/cart/line-identity.test.ts`; confirm the new contract tests fail before implementation.
- [ ] Implement the exported contracts and line-key helper, adopting existing cart limits and negotiation/voucher representations rather than inventing replacements. Record exact inherited limits in the contract document.
- [ ] Run the new shared tests and `pnpm --filter @baci/shared typecheck`; record passing results.
- [ ] Review and commit only this task's files using the review protocol below.

## Task 2: Prove scoped guest access and add the canonical schema

**Files:** Create append-only migrations `supabase/migrations/<fresh_timestamp>_commerce_cart_core.sql` and `<fresh_timestamp>_commerce_cart_roles.sql`; create `supabase/tests/commerce_cart_access.sql`; create `apps/web/src/lib/cart/{principal.ts,scoped-client.ts,session-proof.ts}` and their tests. Reference existing `apps/web/src/lib/supabase/{server.ts,client.ts,scoped-jwt.ts}` without widening existing privileges.

**Interfaces:** Produces branded `CartPrincipal`, `resolveCartPrincipal(request: Request): Promise<CartPrincipal>`, `createCartScopedClient(principal: CartPrincipal)` and `verifyCartSessionProof(proof: string): VerifiedCartSession`. Trusted merchant resolution is part of principal construction; arbitrary callers cannot instantiate authority from body fields.

- [ ] Write isolation fixtures for merchants A/B and guests A1/A2/B1. Assert wrong merchant/cart/grant, missing/expired/revoked proof, forged subject, ordinary anon/customer roles and the receive-only role cannot mutate or read unauthorized rows.
- [ ] Add a local integration fixture proving the dedicated role can use only its intended cart operations and cannot query customers, private catalog fields, orders or payments. Test existing customer and merchant sessions remain intact.
- [ ] Run `pnpm exec supabase test db supabase/tests/commerce_cart_access.sql` against the isolated local database and the new web unit tests; observe the missing-policy failures.
- [ ] Implement schema, RLS and narrow grants. Bootstrap only establishes anonymous principal proof; the subsequent bounded creation operation atomically creates cart, grant and creation receipt under that principal/tenant and cannot read or attach an existing cart by ID. Use invoker RLS operations by default; any required definer wrapper must have an explicit search path, caller checks and minimum execution grants.
- [ ] Add the pre-cart creation receipt scope, bootstrap-proof namespace, internal publisher/cleanup grants, disabled enrollment flags and bounded cleanup. Test cross-environment proof rejection, same-host merchant tabs, absolute proof expiry versus sliding cart expiry, and caller failure to mint or widen a grant.
- [ ] Prototype accepted signing/role behavior locally, including replay, audience, expiry and signing rotation. Record a pass/fail decision in `docs/architecture/shared-cart-contract.md`; do not activate an unproved path or substitute service-role access.
- [ ] Rerun SQL and principal/session tests; verify direct REST/RPC attempts under real local roles, not only mocked JavaScript assertions. Review and commit.

## Task 3: Implement atomic cart operations and authoritative pricing

**Files:** Create `apps/web/src/lib/cart/{service.ts,repository.ts,pricing.ts,mutation-errors.ts}` with colocated tests; create `apps/web/src/schemas/cart.ts`; add `<fresh_timestamp>_commerce_cart_commands.sql`, `supabase/tests/commerce_cart_commands.sql` and `supabase/tests/commerce_cart_concurrency.sql`.

**Interfaces:** Consumes Task 1 contracts and Task 2 principal. Produces `getCart(principal): Promise<CartSnapshot>`, `createCart(principal, input: CreateCartInput): Promise<CartResult>` and `mutateCart(principal, input: CartMutationInput): Promise<CartResult>`. Implement dedicated transaction/RPC operations rather than read-modify-write across independent requests. Keep service/repository logic independent of Next.js cookies, request globals and server-only module markers; inject the verified scoped client. The standalone MCP process must consume this logic without importing Next.js runtime modules.

- [ ] Write regression cases: two simultaneous first creations with the same bootstrap/key produce one cart; duplicate add replays once; same key/different body conflicts; stale remove/set/replace conflicts; two simultaneous operations cannot lose an update; response loss reconciles; foreign product/variant rejected; exact variant quantity/price used; last removal keeps cart active. Retry an older committed operation after another device's newer mutation and after response-body retention expires.
- [ ] Write pricing cases for unavailable offers, quantity bounds, voucher exclusivity, negotiation invalidation, integer minor-unit totals and changed currency/context. Assert no client-supplied price becomes authoritative.
- [ ] Run new Vitest and local SQL tests to record failures.
- [ ] Implement the transaction: authorize → reserve/lock the operation key → recheck replay → lock/version check → command-specific catalog/rule validation → mutate lines → calculate snapshot/version → persist result and minimal event in the same transaction. Define a consistent lock order across mutation, merge, migration and checkout. A no-op preserves the version; a successful change increments it once.
- [ ] Test deleting an unavailable variant and lowering quantity during catalog failure, with another stale survivor present. Such changes succeed with warnings; unauthorized actions, increases or final checkout cannot bypass their applicable validation.
- [ ] Verify database rollback leaves no partial cart/operation/event, and a retry after a committed response loss returns the committed result. Run SQL concurrency tests using two real local sessions.
- [ ] Review and commit.

## Task 4: Migrate MCP/UCP cart ownership without duplicate writers

**Files:** Create `apps/web/src/lib/cart/{legacy-migration.ts,legacy-migration.test.ts}` and `apps/web/mcp-server/guest-cart-read-tool.ts` with tests; modify `apps/web/mcp-server/{guest-cart-store.ts,guest-cart-tool.ts,guest-cart-tool-responses.ts,cart-handoff.ts}`, `apps/web/src/schemas/mcp-guest-cart.ts` and their tests. Prepare the adapter in `apps/web/src/lib/agentic/ucp-cart-storage.ts`; add `<fresh_timestamp>_commerce_cart_legacy_mapping.sql` and `supabase/tests/commerce_cart_legacy_mapping.sql`. Any changes to existing RPC definitions belong in this new migration, never in historical migrations.

**Interfaces:** Produces `resolveCanonicalCart(principal, legacyReference): Promise<CartSnapshot>` and a transactional migration receipt. External legacy identifiers remain adapters, never a second authoritative store.

- [ ] Write fixtures for an existing MCP token, UCP cart, empty cart, expired reference and a reference whose tenant cannot be proven. Concurrent first access maps exactly once; unproved ownership fails closed.
- [ ] Run the new tests and affected existing MCP/UCP tests to establish failures.
- [ ] Implement lazy migration after verifying caller, token and merchant provenance. Hash legacy capability references in the mapping table. Do not assign all unscoped historical MCP rows to Ogabassey without verifiable deployment provenance.
- [ ] Fence every old update/delete RPC and direct UCP write path at the database boundary before migration. Install the compatibility shim, drain/redeploy old workers and verify their capabilities before enabling migration; race an old writer against first import in SQL tests. An unfenced writer blocks migration. Preserve old rows for recovery, but make them non-authoritative after the mapping commits.
- [ ] Route all subsequent legacy and new writes for a migrated cart to the canonical service. Preserve existing MCP tool names, absolute-quantity input semantics and accurate mutation annotations; return stable line IDs for precise removals.
- [ ] Extend MCP schema/metadata with stable `operation_id`, `expected_version`, current cart version and line IDs, plus a read-only cart refresh tool. Existing inputs have only product, absolute quantity and token; do not synthesize a fresh version for an old request and claim stale-write protection. Keep unlinked legacy carts on their original compatibility flow; once linked, a missing version/key returns a refresh/upgrade response with no mutation. Product-only edits require exactly one matching line; multiple variants require explicit line selection. Add an input/output fixture matrix for old and new callers, including empty-cart token semantics.
- [ ] A storage outage returns a retryable error and preserves the token. Do not reuse the current `hasToken` helper's outage-as-false behavior to decide whether to create a cart; its inspected callers are tests, not proof of a production duplicate-cart bug. Update tool descriptions to distinguish old snapshot transfer from linked shared carts and accurate idempotency guarantees. Do not activate UCP migration until Task 12 passes.
- [ ] Test natural-language tool fixtures for “remove it,” “remove the charger,” multiple variants and ambiguous references. Do not claim the model's approval prompts are removed by a storage change.
- [ ] Verify the standalone MCP typecheck/startup harness and a fresh cart read after a web mutation. Keep old ChatGPT messages distinguishable from the current cart; test any active-widget refresh using the documented host bridge before promising that behavior.
- [ ] Test disabling new-cart enrollment leaves migrated carts on the canonical read/write path. Review and commit.

## Task 5: Add authorized cart HTTP endpoints

**Files:** Create `apps/web/src/app/api/storefront/cart/route.ts`, `cart/bootstrap/route.ts`, `cart/commands/route.ts` and colocated route tests; create `apps/web/src/lib/cart/{request-context.ts,response.ts}` with tests. Extend the Task 3 schema file.

**Interfaces:** `POST /api/storefront/cart/bootstrap` establishes bounded anonymous retry identity without creating a cart; `GET /api/storefront/cart` returns the authorized snapshot; `POST /api/storefront/cart` lazily creates a guest cart using that proof and creation key; `POST /api/storefront/cart/commands` consumes `CartMutationInput`. Return safe, typed error codes and `Cache-Control: private, no-store`. Model temporary unavailability separately from not-found/expiry.

- [ ] Write tests for malformed JSON, wrong tenant/domain, absent proof, quota exhaustion, invalid command, stale version, CSRF/cross-origin browser request and native bearer authentication. Client JSON must never override the resolved merchant.
- [ ] Run route tests and confirm failures before implementation.
- [ ] Implement through Task 2/3 interfaces and existing trusted storefront host resolution. Apply current origin/CSRF policy for browser cookies and the existing bearer contract for native clients; do not copy browser CSRF requirements onto MCP/provider calls.
- [ ] Cover custom domains, merchant subdomains and slug-based stores on the common platform host. A supplied slug/domain is a lookup hint resolved through the established published-store mapping, never authority; compare the resolved merchant with the proof/config. Reject forged forwarded-host context. Test two stores open on one origin without cookie or response-cache collisions.
- [ ] Ensure public catalog GETs create no cart, auth user or cookie. Creation and mutation quotas reuse current rate-limit primitives, scoped by tenant/principal with bounded unauthenticated creation controls.
- [ ] If the existing proxy blocks the intended route, prepare its narrow diff and tests; obtain the required explicit proxy authorization before editing that file.
- [ ] Run focused tests, web typecheck and lint for changed files; review and commit.

## Task 6: Build secure, replay-safe cart handoff and merge

**Files:** Create `apps/web/src/lib/cart/{handoff.ts,merge.ts}` and tests; create `apps/web/src/app/api/storefront/cart/handoff/route.ts`, `cart/handoff/redeem/route.ts` and tests; create `apps/web/src/components/storefront/cart/cart-handoff.tsx` and its test; modify `apps/web/mcp-server/cart-handoff.ts` and `apps/web/src/components/storefront/ogabassey/pages/cart-page-wrapper.tsx`.

**Interfaces:** `issueCartHandoff(principal, destination): Promise<{continueUrl:string;expiresAt:string}>`; `redeemCartHandoff(request, choice: 'connect'|'merge'|'keep_existing'): Promise<CartResult>`. Destination comes from approved merchant domains/app links. Merge consumes both authorized snapshots and both versions transactionally.

- [ ] Test preview GET, expired grant, wrong domain/merchant, repeated redemption, interrupted response and old links. GET renders a continuation screen and never consumes the grant.
- [ ] Test a browser with the baseline Tecno line plus an incoming charger/camera cart; only an explicit merge combines them. Same-line quantities use max, repeated import does not increment, and conflicting voucher/negotiation contexts require a choice.
- [ ] Test cart selection and grant membership after connect/merge/keep-existing, including third-party linked grants, active checkout, two concurrent merges and response loss. No merge broadens saved-detail/account authority or silently forwards another principal's grant.
- [ ] Run failing tests; implement a five-minute single-use hashed grant and POST redemption, with a bounded receipt bound to the same destination session/attempt for safe response-loss reconciliation. A different session cannot reuse a consumed grant.
- [ ] Set a host-only session cookie, strip the grant from the address bar and use no-store/no-referrer handling. The handoff URL must not carry a reusable write credential. Offer clearly labelled choices when an existing cart is present.
- [ ] Keep raw pairing secrets out of access logs and client analytics, not just application logs; remove the URL secret before loading third-party scripts. For first POST response loss, persist a destination attempt proof before redemption and reissue its session proof from the committed receipt. Mere knowledge of the consumed URL is insufficient for recovery.
- [ ] Keep protocol replay receipts separate from five-minute pairing secrets. A replayed CreateCart response must not mint a new cart or silently replace a consumed grant. On expired continuation, an already-bound destination can recover; a new destination obtains a fresh handoff only through an authorized originating session. Test retries after five minutes and after the protocol retention window; never put a raw write/pairing credential in generic response logs or operation records.
- [ ] If an exact protocol response includes a pairing URL, preserve its replayability in a narrowly scoped encrypted response receipt, with key/retention policy established in Task 2; the grant table stores only its hash. Ordinary cart operation records remain credential-free. Encryption is not log redaction: assert request/response telemetry excludes this value. Do not invent a longer-lived secret URL to bypass the recovery rules.
- [ ] Test old handoff compatibility and that selecting “keep existing” leaves both carts intact. Review and commit.

## Task 7: Connect the web cart with optimistic feedback and fetch recovery

**Files:** Create `apps/web/src/hooks/cart/{use-shared-cart.ts,shared-cart-client.ts,shared-cart-reducer.ts}` with tests; modify `storefront-cart-provider.tsx`, `cart-storage.ts`, `cart-persistence.ts`, `cart-types.ts` and existing merchant-switch tests.

**Interfaces:** `useSharedCart({merchantId,sessionGeneration})` exposes the existing cart UI actions backed by confirmed `CartSnapshot` plus pending commands. Local storage is a display/recovery cache and legacy import source, not an independent writer after linking.

- [ ] Test immediate optimistic feedback, failed-operation rollback, temporary-line handling, late responses after merchant switch/logout, stale totals and failed legacy import. Retain existing voucher/negotiation behavior.
- [ ] Run the focused cart tests to establish failures.
- [ ] Implement lazy server-cart creation on the first cart action, authoritative response reconciliation and generation fencing. During disconnection preserve the last confirmed cart with a visible retry state; do not claim uncommitted offline actions succeeded.
- [ ] Use one per-cart send queue, preserve original retry keys until outcomes reconcile, and reject lower-version responses within a generation. Test rapid add→remove before the first response, two pending quantity edits, and an old replay after a new broadcast. Mutations targeting an unconfirmed optimistic line wait for its stable server line ID.
- [ ] Import existing local items exactly once through Task 6 rules before switching ownership. Preserve the old cache until a migration receipt confirms success.
- [ ] Add foreground/focus fetch and a 15-second jittered fallback poll only while an active cart surface is visible and realtime is unavailable. Stop polling when hidden or unlinked.
- [ ] While an active cart surface is visible, also do a low-frequency 60-second reconciliation fetch when realtime appears connected; a silently missed event must not leave the cart stale indefinitely. Jitter/coalesce reads, stop in the background and test the maximum stale-state window with a dropped notification and no later event.
- [ ] Run `pnpm --filter @baci/web exec vitest run src/hooks/cart` and affected handoff tests; review and commit.

## Task 8: Add private realtime notifications and convergence

**Files:** Add `<fresh_timestamp>_commerce_cart_broadcast.sql` and `supabase/tests/commerce_cart_realtime.sql`; create `apps/web/src/lib/cart/{realtime-access.ts,event-publisher.ts}`, `apps/web/src/app/api/storefront/cart/realtime/route.ts` and their tests; create `packages/shared/src/cart/{reconcile-version.ts,reconcile-version.test.ts}`; extend the web hook with a focused `use-cart-subscription.ts` module/tests.

**Interfaces:** `getCartRealtimeAccess(principal)` returns a receive-only short-lived credential and exact private topic; `shouldRefreshCart(currentVersion,event): boolean` coalesces newer notifications. No client publish permission.

- [ ] Test wrong-guest/wrong-tenant channel join, publish attempts, token expiry/revocation, duplicate/out-of-order events, join/fetch races and missing events. Verify the receive token cannot read unrelated database data or mutate carts.
- [ ] Run local SQL/realtime integration and unit tests to record failures.
- [ ] Publish only `CartChangeEvent` after a committed mutation through the transactional event path. Marking events delivered must tolerate retries; duplicate notifications remain harmless.
- [ ] Assign the outbox publisher to the existing scoped worker scheduler with a lease, crash recovery, bounded backoff and dead-letter/lag metrics. Test crash after commit, before send and after send/before acknowledgment. UI state changes immediately from successful HTTP replies; outbox delay does not block mutations.
- [ ] Subscribe before the initial snapshot, fetch on successful join, refetch for newer versions and on reconnect/resume. Refresh tokens while authorized; revoke access on identity change. Supabase authorization caching means expiry bounds notification revocation, while every HTTP operation reauthorizes immediately.
- [ ] Reuse one active transport per client/session where possible, disconnect hidden idle cart subscriptions after 60 seconds and retain Task 7 fallback. No socket on a catalog-only visit without an active cart.
- [ ] Prove linked browser A and MCP client B converge after additions/removals without navigation. If the scoped realtime role cannot pass, keep realtime disabled and report the fetch-only behavior accurately. Review and commit.

## Task 9: Add mobile pairing and shared-cart synchronization

**Files:** Create `apps/mobile-storefront/lib/cart/{session-storage.ts,shared-cart-client.ts}` and tests; create `apps/mobile-storefront/hooks/use-shared-cart.ts` and test; modify `stores/cart-store.ts`, `stores/partialize-cart-store.ts`, `hooks/use-cart.ts`, `app/cart.tsx` and the current verified deep-link handler discovered from `app/_layout.tsx`.

**Interfaces:** Consume the same HTTP contracts and `CartSnapshot`; `CartSessionStorage` supplies `get(merchantId): Promise<string|null>`, `set(merchantId, proof): Promise<void>` and `remove(merchantId): Promise<void>` using the existing secure storage primitives. MMKV/AsyncStorage contain only nonsecret display cache.

- [ ] Test two merchant configurations, secure credential persistence, malformed/untrusted deep links, app process restart, foreground recovery, failed mutation, token expiry and late response after switching merchant/account.
- [ ] Run `pnpm --filter @baci/mobile-storefront exec jest --runInBand hooks/use-shared-cart.test.ts lib/cart` to record failures.
- [ ] Implement verified HTTPS app-link handoff with safe browser fallback, Task 6 redemption/merge behavior and the same version/generation reconciliation. Reuse platform primitives and existing auth storage; do not replace customer Auth credentials.
- [ ] Subscribe only while appropriate for foreground use; refetch through AppState resume. Preserve mobile checkout generation, voucher and negotiated-price behavior. Support the existing app's trusted merchant configuration; do not infer a tenant from an arbitrary deep-link host.
- [ ] Run new Jest tests, affected cart store tests, mobile typecheck and platform-drift checks. Exercise both iOS and Android with the repository's current launch/install commands.
- [ ] Review and commit.

## Task 10: Add optional customer continuity without forcing login

**Files:** Create `apps/web/src/lib/cart/{account-link.ts,account-link.test.ts}` and `apps/web/src/app/api/storefront/cart/link-account/route.ts` with tests; integrate `apps/web/src/contexts/customer-auth-context.tsx`, mobile `stores/auth-store-account.ts`, `stores/auth-store-initialize.ts` and their tests. Add grant/account mapping migration only as needed.

**Interfaces:** `linkCartToCustomer(principal, verifiedCustomer, choice): Promise<CartResult>` verifies the existing customer relationship within the same merchant. Same-device linking retains the cart unless the shopper selects a merge; cross-device lookup requires authenticated ownership.

- [ ] Test successful guest checkout without auth, optional account linking, same email/different auth subject, customer shared across merchant relationships, a pre-existing account cart, logout and account switching.
- [ ] Run failures; implement explicit ownership verification and Task 6 merge rules. A save-details checkbox never supplies authentication or silently creates account authority.
- [ ] On logout revoke that device's customer-linked grants, stop subscriptions, clear private caches and begin a fresh guest session. Existing delegated cart grants do not gain saved-address/account scopes merely because the cart was attached to an account.
- [ ] Test that neither a stale response nor browser back navigation restores the previous customer's private context. Run web/mobile focused tests; review and commit.

## Task 11: Make checkout consume the current canonical cart

**Files (11A, server/web):** Create `apps/web/src/lib/cart/{checkout-transition.ts,checkout-transition.test.ts,order-binding.ts,order-binding.test.ts}`; add `<fresh_timestamp>_commerce_cart_order_binding.sql` and `supabase/tests/commerce_cart_order_binding.sql`. Modify the narrow integration edges in `apps/web/src/app/api/orders/route.ts`, `apps/web/src/schemas/orders.ts`, `apps/web/src/lib/agentic/{ucp-cart-checkout-conversion.ts,checkout-completion-finalize.ts}`, `apps/web/src/components/storefront/ogabassey/pages/checkout/derive-checkout-cart-model.ts`, its `hooks/use-checkout-order-submission.ts`, and `apps/web/src/lib/checkout/build-order-items.ts` with their tests. Add `apps/web/tests/checkout-browser/shared-cart-handoff.pw.ts`.

**Files (11B, after Task 9):** Integrate `apps/mobile-storefront/app/checkout.tsx` through a new focused `apps/mobile-storefront/hooks/use-cart-checkout-snapshot.ts` and test; update `components/checkout/checkout-submit-order-request.ts`, `services/orders.ts`, `lib/replay-queued-create-order.ts` and their tests to preserve the cart checkout binding.

**Interfaces:** `prepareCartCheckout(principal, {cartId,expectedVersion,operationId}): Promise<CartCheckoutSnapshot>` returns the authoritative lines, validated estimates, cart version and one active checkout session reference. It does not submit an order or initiate payment.

- [ ] Write tests: two variants added, one removed, only remaining lines enter checkout; repeated preparation reuses the session; stale version requires refresh; changed price/availability is shown; completed cart cannot reopen the old checkout generation.
- [ ] Run failing tests; implement atomic conversion/reuse and server-side revalidation. Existing checkout/order APIs remain responsible for final purchase authorization and idempotency.
- [ ] Add an authenticated cart/checkout binding and expected cart version to the shared-cart order path. In the final database transaction, reauthorize and lock cart + checkout, compare the reviewed version/lines, preserve existing stock/discount/voucher/savings checks, and atomically create/replay one order for that checkout generation. Client locks and an earlier snapshot read are not sufficient. Two different order idempotency keys for one generation must not create two orders.
- [ ] Ordinary cart tokens remain unable to call order/payment RPCs. Use a separately authorized checkout boundary with the existing buyer-consent/auth contract. A binding asserts cart provenance, not purchase permission. Preserve legacy checkout paths for unlinked carts; shared clients must not downgrade to that path after an error or omit the binding during native queued replay.
- [ ] During an active editable checkout, canonical cart edits invalidate the displayed checkout revision and require a refreshed review. Race a cart removal against final order creation: if removal wins, the stale order fails before side effects; if order creation wins, subsequent cart edits fail against the closed generation. Database failures roll back both transitions; indeterminate outcomes reconcile the same order. No external payment call occurs while holding cart locks.
- [ ] Reflect checkout line removals/quantity changes back to the same cart through the service, with negotiation and voucher rules enforced. Close the cart generation atomically when its order is durably created, including a pending-payment order; payment retries/resume use that same order. “Completed cart” does not mean payment succeeded. Cancellation or payment failure does not silently reopen the submitted generation; new shopping creates a new cart intentionally.
- [ ] In local transactional tests, exercise direct server submission, stale/tampered line payloads, foreign cart binding, two different order keys, payment-pending recovery, order rollback and native offline replay after a cart change. Mock/disable outbound side effects. Live QA still ends before order creation.
- [ ] Run the browser harness with order/payment endpoints blocked or mocked and verify no submission request occurs. Review and commit.

## Task 12: Reconcile existing UCP and add Google-style transfer contracts

**Files:** Modify `apps/web/src/app/api/agentic/carts/route.ts`, `[id]/route.ts`, `[id]/cancel/route.ts` and tests; modify `apps/web/src/lib/agentic/{ucp-cart-route-support.ts,ucp-cart-response.ts,ucp-shopping-profile.ts,universal-cart-readiness.ts}` and tests; create `apps/web/src/lib/cart/{ucp-adapter.ts,ucp-adapter.test.ts}` and protocol fixtures under `apps/web/src/lib/cart/fixtures/ucp/`.

**Interfaces:** `importPlatformCart(principal, platformRequest): Promise<UcpCartResponse>` maps approved external offer IDs to canonical identities and returns a safe `continue_url`. Existing CRUD uses the canonical service; the Google transfer adapter performs creation/import only.

- [ ] Pin fixtures to the platform-supported version (initially the reviewed `2026-04-08` contract) and recheck official schemas before execution. Do not copy the general `2026-08-25` examples into an older declared profile.
- [ ] Test repeat transfer, key/body mismatch, foreign-merchant offer, wrong platform grant, absent customer identity, expired handoff, business error within HTTP 200 and disabled native payment support.
- [ ] Run failures; replace independent UCP cart writes with Task 3/4 calls. A platform cart remains scoped to its caller until explicit handoff/linking.
- [ ] Protect full replacements: platform-owned sessions accept serialized complete replacements; after handoff marks a cart shared, require a negotiated concurrency precondition for replacement. If unavailable, return the version-appropriate conflict/continuation outcome and preserve the newer cart. Do not invent mandatory fields and claim standard conformance.
- [ ] Apply the shared-ownership gate to cancel and cart→checkout as well as replacement; a delayed platform cancel must not erase a linked web cart. Scope creation receipts by verified platform caller, tenant, protocol route and supplied idempotency key before a canonical cart ID exists; include an external reference only when that protocol actually provides one. Map exact versioned headers/errors instead of assuming all platforms send Baci's internal version/key fields.
- [ ] Split cart-transfer readiness from native-checkout/payment/order readiness. Advertise only operations actually available for that merchant. Preserve supported existing checkout flows.
- [ ] Verify protocol fixtures and existing route tests; document the separate Google enrollment/eligibility gate. No Google production connection, AP2 purchase mandate or agent payment feature is included in this task. Review and commit.

## Task 13: Run end-to-end, isolation and SEO qualification

**Files:** Create `apps/web/tests/checkout-browser/shared-cart-concurrency.pw.ts`; extend `shared-cart-handoff.pw.ts` and `request-allowlist.ts`; create `docs/qa/shared-cart-acceptance.md`. Reuse current storefront performance tooling and mobile integration harnesses.

**Interfaces:** Consumes all preceding surfaces; produces a reproducible evidence matrix tagged with commit, environment, merchant, client and results, without credentials or personal data.

- [ ] Run two merchants × two guests with linked MCP/web/native clients. Prove cross-tenant/cart/topic attempts fail and the selected variant/condition/quantity is identical across authorized surfaces.
- [ ] Exercise add two items → remove charger → reconnect → checkout; repeat with “remove it,” ambiguous variants, empty cart, double click, lost HTTP response, dropped/out-of-order events, import retry and logout mid-request.
- [ ] Exercise legacy migration, Google-style single transfer, negotiated UCP replacement and unversioned replacement after handoff. Verify unrelated existing browser items are never silently discarded.
- [ ] Verify guest checkout reaches its review summary without account creation; save-details remains optional. Block actual order/payment/shipment calls and preserve test users' pre-existing carts.
- [ ] Compare public product/category HTML, canonical links, structured data, cache headers and sitemap behavior before/after. Verify private cart/handoff noindex/no-store handling; do not assume robots blocking alone establishes noindex.
- [ ] Measure repeatable storefront performance with the existing visual/performance guide. Proposed gates: no cart session/socket on a cart-free catalog visit, no new layout shift from cart UI, no statistically meaningful LCP/INP regression, and successful foreground convergence p95 within 2 seconds under the same-network pilot fixture. Record actual baseline/sample size; do not substitute a target for measured evidence.
- [ ] Run final full-monorepo lint/typecheck/tests because this changes shared runtime and multiple consumers, plus SQL replay/role tests and affected browser/mobile checks. Report pre-existing failures separately.
- [ ] Complete required CodeRabbit and exact-head PR review/CI gates. Review and commit the evidence/runbook changes.

## Task 14: Prepare rollout, operational recovery and authorized release

**Files:** Create `docs/deploy/shared-cart-rollout.md`; qualify the cleanup/expiry job and enrollment flags introduced in Tasks 2–4 and the outbox publisher from Task 8; extend scoped capability preflight and metrics where the cart release currently checks dependencies. Add operational tests for expiry cleanup and flag routing.

**Interfaces:** Operates merchant-scoped `shared_cart_enabled` and `shared_cart_realtime_enabled` controls using the existing feature mechanism, an exact-release checklist and nonsecret operational metrics. New flag/config fields are additive and disabled by default from the foundational phase.

- [ ] Test idle expiry/cleanup, access revocation, event/idempotency retention, migration restart and feature disablement. Cleanup must not delete active checkouts or unexpired retry receipts.
- [ ] Record metrics for mutation latency/conflicts/replays, rejected access, migration failures, handoff completion, realtime join/reconnect, convergence, active sockets and checkout version mismatches. Avoid cart credentials and customer data in labels/events.
- [ ] Prepare the concrete migration, role/key provisioning, VPS/MCP/web release and rollback steps at one reviewed SHA. Recheck current free disk and release preflight before any authorized build.
- [ ] Obtain any outstanding explicit environment/proxy/production authorization for this release after the exact changes are reviewable. Previous release-specific exceptions do not cover new permissions or deployments automatically.
- [ ] Release additive migrations and compatible server adapters before client activation. Pilot Ogabassey, then a second controlled merchant, then expand after the acceptance matrix passes. Keep old clients compatible throughout.
- [ ] Rollback by disabling new enrollment/realtime first while preserving canonical ownership for migrated carts. Keep the last compatible server version available. Never restore stale local carts as authoritative or drop the new tables as rollback.
- [ ] Verify deployed code/worker revision, database capabilities and live guest handoff through the review summary. Do not mark release complete from merge/CI alone or place an order for QA.

## Validation and commit protocol

Every task changes only its owned files, adds exact regression coverage, records the initial failure and final pass, then receives review before commit. Run `coderabbit review --agent -t uncommitted` in the task worktree and address valid findings according to repository gates. If unavailable, report that gate as incomplete rather than claiming review. Stage explicit paths, not the whole worktree.

Representative commands confirmed from the inspected manifests:

```sh
pnpm --filter @baci/shared exec vitest run src/cart
pnpm --filter @baci/shared typecheck
pnpm --filter @baci/web exec vitest run src/lib/cart src/hooks/cart
pnpm --filter @baci/web typecheck
pnpm --filter @baci/mobile-storefront exec jest --runInBand hooks/use-shared-cart.test.ts lib/cart
pnpm --filter @baci/mobile-storefront typecheck
pnpm --filter @baci/mobile-storefront check:platform-drift
pnpm exec supabase test db supabase/tests/commerce_cart_access.sql
pnpm turbo lint
pnpm turbo typecheck
pnpm turbo test
```

Use the current repository's local SQL setup/replay procedure before the Supabase command; never point destructive test setup at production. Read `docs/agent-guidance/validation.md` if present on execution main. It was absent from the inspected release/cached-main snapshots, so the full cross-package gate above is the fallback required by the user-supplied instructions. Native/browser launch commands must be re-read at execution time.

## Completion evidence

The feature is complete only when guest access and two-merchant isolation pass, active linked web/app carts converge with ChatGPT-originated operations, fresh ChatGPT cart reads reflect web/app changes, checkout contains exactly the remaining lines, existing cart rules survive, the UCP transfer contract passes, and the reviewed release is verified in its intended environment. Google enrollment, future UCP versions, AP2 payments, background purchasing, full offline queues and a combined multi-merchant checkout are separate projects.

## Plan self-review

- Guest checkout, optional identity and save-details boundaries: Tasks 2, 5, 6, 10, 11, 13.
- Tenant isolation, credential scope and custom domains: Tasks 2, 3, 5, 6, 8, 9, 12, 13.
- Existing MCP/UCP/local carts and rollback: Tasks 4, 6, 7, 12, 14.
- Shopify line IDs, optimistic state, warnings and fresh checkout: Tasks 1, 3, 7, 9, 11.
- Google transfer/version/replacement semantics: Tasks 6, 12, 13.
- Live delivery, reconnects and mobile lifecycle: Tasks 7–9, 13.
- SEO, performance, cost and operational verification: Tasks 8, 13, 14.
- Each Review Focus condition above has an assigned test owner. The unresolved technical feasibility of scoped guest/realtime roles is an explicit local proof gate in Task 2, not an assumed production capability.

## Second review record — 11 October 2026

This review checked the plan against the recorded release checkout, not a new production audit. The entries below describe gaps in the earlier plan, all revised in this document. They are not claims that implementation or live fixes have been completed.

| Priority | Gap found | Revision and verification owner |
| --- | --- | --- |
| High | A creation retry had no receipt key independent of the newly allocated cart ID; two concurrent duplicate commands could also race the replay lookup. | Pre-cart bootstrap/creation receipts, database operation serialization, late-retry tombstones and lower-version response rejection. Tasks 2, 3, 7. |
| High | The current MCP schema has no version, operation key or line selector, so preserving it unchanged could not provide the promised shared-cart conflict protection. | Explicit old/new schema matrix, refresh tool, line selection and no-write upgrade response for linked carts lacking concurrency fields. Task 4. |
| High | App-level routing alone could leave an older worker writing the legacy row after migration. Existing MCP upsert/delete RPCs have no canonical mapping check. | Database writer fencing, deployment ordering and a mixed-worker migration race test. Task 4. |
| High | Checkout work named client adapters but omitted the final order transaction; a removal after preparation could still race a stale order payload. | Server/RPC cart-version and checkout-generation binding, one-order enforcement, durable pending-payment semantics, direct-call and native queued-replay tests. Task 11A/B. |
| Medium | Whole-cart catalog validation could block removing an unavailable item; replay/outage handling could also regress the shopper's newer state. | Command-specific validation, explicit unavailable errors, a per-cart send queue and replay-aware state reconciliation. Tasks 3, 4, 7. |
| High | Merge membership, same-host merchant cookies and recovery after losing the first redemption response were underspecified. | Explicit canonical merge target/grant restrictions, merchant namespaces, preexisting attempt proof and encrypted protocol receipts where exact replay includes a URL. Tasks 2, 5, 6. |
| Medium | Realtime could stay connected while missing an event, and worker delivery/cleanup ownership arrived too late in the phase sequence. | Outbox leases/recovery, visible-cart reconciliation, early flags/retention and separate web/native checkout dependencies. Tasks 2–4, 7, 8, 11, 14. |

Code evidence inspected includes `apps/web/src/schemas/mcp-guest-cart.ts`, `apps/web/mcp-server/guest-cart-store.ts`, `supabase/migrations/20261008230100_mcp_guest_cart_write_rpcs.sql`, `apps/web/src/app/api/orders/route.ts`, `apps/web/src/lib/agentic/ucp-cart-checkout-conversion.ts` and `apps/mobile-storefront/services/orders.ts`. Existing helpers and RPCs are evidence for the integration boundary, not blanket permission to copy their privileges.

Official references rechecked during review:

- Google's reviewed integration sends a full basket on one CreateCart transfer; this continues to be a separate adapter from linked live-cart synchronization. [Google Cart API implementation](https://developers.google.com/merchant/ucp/implementation/2026-04-08/cart-api).
- The current general REST binding requires matching-key response replay and at least 24-hour retention in its idempotency section. Its examples use `2026-08-25`, so these mechanics do not prove an older adapter's exact conformance. The attempted archived `2026-04-08` REST page was unavailable through the research tool; obtaining the exact supported schema/error contract remains Task 12's gate. [Current UCP REST binding](https://ucp.dev/specification/shopping/cart/rest/).
- Supabase caches channel access until reconnect/new JWT and disconnects at JWT expiry; database grant revocation alone does not immediately stop an existing subscription. Keep short receive-token expiry, minimal events and independent HTTP authorization. [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).

**Review outcome:** Ready to begin the bounded local authorization/contract work. Activation remains conditional on its real-role tests, the MCP retry/version contract, exact protocol fixtures and the applicable phase's acceptance gates. Document structure, integration paths and local links are checked; no runtime tests were run for these documentation-only revisions.

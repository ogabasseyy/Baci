# Ogabassey Generative Search Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This plan does not authorize delegation, deployment or payment-flow replacement.

**Goal:** Help shoppers discover and compare real products through a stable search interface and optional generative assistance, then purchase through the existing cart and checkout.

**Architecture:** Normal catalog search remains the primary path. A server-owned assistant emits validated domain events rendered by existing web/native components. Comparison uses existing comparison state; all cart mutations and checkout navigation use established application actions.

**Tech Stack:** Current pnpm monorepo, shared TypeScript/Zod contracts, Next.js, Expo/React Native, Supabase under RLS, existing AI SDK 6 and keyboard-controller. No new renderer dependency in the first production increment.

**Spec:** [Research and proposed experience](../../plans/2026-10-02-ogabassey-generative-search-research.md). This plan narrows that proposal to preserve existing commerce behavior.

## Decisions and global constraints

- This is an enhancement to discovery and selection. The customer has one existing cart and one existing checkout flow on each platform.
- Search, comparison and assistant state never become an alternative cart. A comparison selection is not a purchase selection.
- First release includes keyboard behavior, progressive cards, assisted filters and comparison entry points. It does not embed payment forms, create new order/payment endpoints or change checkout-generation recovery.
- Existing shipping, guest/sign-in, stock validation, pricing, negotiated prices, vouchers, assurance, payment choices, order creation and payment reconciliation retain their authoritative handlers.
- The later shortcut is labelled “Add to cart” or “Continue to checkout”; it adds an exact selection to the existing cart. An existing multi-item cart goes intact to checkout. Do not present a single-item total while checking out the entire cart.
- The assistant does not initiate purchases. Streamed presentation events never invoke cart mutations. A customer action is required.
- Ordinary search remains usable when AI is disabled, slow, unavailable or invalid. No model call per keystroke.
- Both app and web are part of every task's impact review. Platform geometry may differ, while filter, comparison and purchase semantics remain consistent.
- Shared runtime belongs in packages/shared; use normal RLS clients, trusted merchant resolution, bounded inputs/results, existing AI rate limits and server-side model credentials.
- No environment/proxy changes, historical migration edits or service-role exceptions are authorized by this plan.
- No manual React memoization. New modules should have one responsibility and normally remain below 300 lines.
- Use current installed SDK-major documentation. A new package adoption requires the renderer trial in Task 6, not copying a latest-major example.

## What exists and what the comparison gap means

Verified in the current task worktree:

| Area | Existing source | Plan |
| --- | --- | --- |
| Native comparison | `apps/mobile-storefront/stores/comparison-store.ts`, `app/compare/index.tsx`, `components/compare/CompareView.tsx` | Reuse the existing maximum of three products and comparison screen. Refresh facts before comparing/purchasing; persisted products can be stale. |
| Ogabassey web comparison | `apps/web/src/components/storefront/ogabassey/providers/v2-comparison-context.tsx`, `components/ProductComparisonTable.tsx` | Use the active Ogabassey provider; do not create a competing comparison store or use the unrelated generic hook by mistake. |
| Search cards | Native `components/search/SearchResultsList.tsx`; web search `../products/product-index-card.tsx` | Add discoverable comparison entry points without making whole cards ambiguous. |
| Assistant presentation | Web `src/schemas/storefront-agent-ui-contract.ts` and `components/.../chat/agent-ui-event-renderer.tsx` | Currently only present_products with several shopping intents. Introduce filter/clarification/comparison events, with a native renderer. |
| Assistant transport | Web `src/app/api/chat/negotiate-chat-agent-ui-response.ts` | Currently buffers full text before JSON. Add negotiated incremental transport while retaining existing clients. |
| Native cart | `stores/cart-store.ts`, `stores/cart-store.types.ts`, product selection/cart hooks | Preserve addItem, cart-line identity, negotiations and checkout generation. |
| Web cart | `src/hooks/cart/cart-types.ts`, `storefront-cart-provider.tsx` | Use addToCart(product, quantity, options); preserve variant/condition identity and merchant scope. |

The gap is search/assistant integration, clear factual comparison and refreshed data. Comparison itself already exists on both platforms. A model may explain verified differences; it must not invent specifications or claim an unavailable option can be bought.

## Review focus

1. Pre-existing multi-item cart: adding from search retains its lines/options; checkout summary reflects the real cart.
2. Persisted comparison or delayed assistant result: facts refresh and older requests cannot replace newer query/merchant state.
3. Keyboard, browser/native Back and option-sheet dismissal: typing/focus and search position survive without duplicate interactive inputs.
4. Model timeout or malformed/partial event: ordinary results remain usable and no actionable incomplete product renders.
5. Stock/price/option changes between discovery and purchase: the normal purchase validation surfaces the change before checkout.

## Task 1: Stable keyboard search and progressive listing

**Files:** Modify native `components/search/SearchScreenView.tsx`, `SearchResultsHeader.tsx`, `search-screen.styles.ts`; create `components/search/SearchComposer.tsx` and `.test.tsx`. Extend a shared keyboard primitive if needed. Review web `src/app/(storefront)/[slug]/(catalog)/(listing)/search/search-page-form.tsx` and its tests; desktop retains header positioning.

**Interface:** `SearchComposer` accepts controlled query, onQueryChange, onSubmit, onClear and accessibility labels. Keyboard movement does not reset query, selection or focus. It shares search semantics with existing header, not another query store.

- [ ] Write failing component tests for typing during keyboard motion, dismissal/back, retained query, submit once and complete product text before an image loads. Test web existing input remains usable.
- [ ] Use keyboard-controller through the existing shared abstraction to animate a single focused input above the keyboard and preserve the result-region/header footprint. Respect reduced motion and safe areas. Reserve sufficient bottom space so cards/controls remain reachable.
- [ ] Keep images independent of text and prices. Do not animate result order or remount cards on each streamed update.
- [ ] Run scoped Jest/Vitest tests and Biome. Verify actual iOS/Android keyboard opening, landscape, dismissal and hardware-keyboard behavior. Mobile web gets browser verification before any docking is enabled; otherwise retain its stable header.
- [ ] Record baseline first usable card time under slow images and slow data separately. Commit only task files after required review.

## Task 2: Connect search to existing comparison

**Files:** Modify native `components/search/SearchResultsList.tsx`, `app/compare/index.tsx`; add colocated tests and `stores/comparison-store.test.ts`. Modify web `src/app/(storefront)/[slug]/(catalog)/(listing)/products/product-index-card.tsx`; integrate active provider through a focused client control. Extend `components/.../ProductComparisonTable.test.tsx` and provider tests as needed.

**Interface:** Search comparison actions accept a trusted product identity plus display snapshot. Selection is held by existing stores. New `buildComparisonRows(products)` shared helper returns factual rows with missing values represented as null; it never chooses purchase variants or mutates cart. Create `packages/shared/src/lib/product-comparison.ts` and `.test.ts`, export through the existing lib barrel.

- [ ] Write failing tests: add/remove from search, existing platform limit preserved with clear feedback, duplicate IDs, missing specs displayed as unknown, different-category comparison communicated clearly, returning from comparison preserves query and scroll.
- [ ] Reuse existing comparison providers/stores; verify active web provider scope. Refresh selected products through merchant-scoped normal catalog helpers when opening comparison. Retain selection on recoverable errors and label unavailable items.
- [ ] Keep price, condition and storage basis visible. Distinguish a parent starting price from an exact matched option; do not equate different variants. Normalize only known attribute aliases/units; omit unsupported “winner” scores.
- [ ] Add a comparison tray/control that remains accessible beside sort/filter and keyboard controls. Native defaults to two products with its existing maximum three; retain the verified web maximum of four. Its current provider replaces the oldest item when adding a fifth; search must make that replacement visible, with regression coverage, instead of silently discarding a selection.
- [ ] Run shared, native and web comparison/search tests; assert comparison interactions leave cart byte-for-byte unchanged. Review and commit.

## Task 3: Shared assisted-search events and optional intent parsing

**Files:** Create `packages/shared/src/lib/shopping-assistance.ts` and `.test.ts`; update shared lib exports. Extend web `src/schemas/storefront-agent-ui-contract.ts` through compatible exports/adapters. Create web `src/schemas/search-assistance.ts`, `src/app/api/search/assist/route.ts` and `.test.ts`. Create platform-local hooks/renderers in native `hooks/use-search-assistance.ts` and web search `search-assistance.tsx`, with tests.

**Interface:** `parseShoppingAssistanceEvent(value: unknown)` validates a versioned discriminated union: applied_filters, clarification_choices, compare_products and trusted product-results references. Request includes requestId, query and current supported refinements; merchant authority is server-resolved, never supplied by model/client. Existing present_products clients retain compatibility.

- [ ] Write failing tests for “used iPhone under ₦500k” becoming supported filters; ambiguous “good camera” remains a preference or explicit clarification. Cover zero budget, unsupported filters, prompt injection, forged product IDs, wrong merchant, unknown events and AI failure.
- [ ] Reuse current refined search schema/query functions and existing catalog tools. Validate IDs and fetch commerce facts server-side. Present inferred filters for the user to see/edit; do not silently discard user-selected filters.
- [ ] Keep normal debounced keyword search independent. Run assistance on explicit submit/suggestion/follow-up. Provide a reversible default-off flag using existing configuration conventions, without editing .env files.
- [ ] Render supported events with existing product/filter/comparison components. Navigation/actions come from an allowlisted application adapter. Never accept arbitrary generated code, URLs, component names or payment instructions.
- [ ] Run shared and both-consumer tests, merchant-resolution/security tests and rate-limit checks. Review and commit.

## Task 4: Incremental assistance without disrupting shopping state

**Files:** Extend web `src/app/api/chat/negotiate-chat-agent-ui-response.ts` and presentation collector using a focused new stream encoder. Create `packages/shared/src/lib/shopping-assistance-stream.ts` and `.test.ts`; create native `services/read-search-assistance-stream.ts` and web reader with colocated tests. Adapt Task 3 hooks.

**Interface:** Versioned complete-event frames carry requestId, sequence and kind (event, done, error). `readAssistanceStream(response, { signal, onEvent })` only delivers validated complete events. Transport is explicitly negotiated; existing buffered clients remain supported.

- [ ] Write failing tests for chunk splits, malformed/oversized frames, duplicate sequence, disconnect, cancellation, query/merchant switch, terminal errors and repeated cart-related presentation. Assert zero cart mutations from stream replay.
- [ ] Emit catalog presentation as tool results arrive, independently of prose completion. Bound frame sizes and sequence state. Abort superseded requests and reject their late frames. Preserve complete cards on interruption and expose retry without duplicating actions.
- [ ] Use version-matched Expo streaming transport; verify actual deployed proxy behavior in an authorized environment. A local stream test is not proof of deployed streaming.
- [ ] Run shared+web+native stream tests; test slow network and app background/foreground. Review and commit.

## Task 5: Optional exact-selection shortcut through normal cart

**Dependency:** Tasks 1–4 verified; separately enable after commerce regression checks. The first release can ship with normal PDP navigation while this remains disabled.

**Files:** Reuse native `components/product/hooks/use-product-detail-selection.ts`, `use-product-detail-purchase-state.ts`, `use-product-detail-cart-actions.ts`. Create a focused search selector/adapter only after isolating reusable selection logic without duplicating it. Reuse web `components/storefront/ogabassey/pdp/critical-variant-selectors.client.tsx` and existing purchase helpers. Add `search-cart-handoff` adapter/tests on each platform. Existing cart/checkout modules are consumers, not wholesale rewrites.

**Interface:** `confirmSearchSelection(selection)` validates fresh product/variant/condition/quantity and calls the existing cart add action. On failure it returns a visible error and performs no navigation. On success, “Continue to checkout” opens the established checkout route for the entire current cart.

- [ ] Write failing integration tests for existing multi-item cart, same-product different variants/conditions, supported quantity limits, out-of-stock selection, price change, minimum order quantity, condition offers and cancellation.
- [ ] Reuse authoritative selection and cart logic, including stock checks and selected image resolution. Retain negotiated prices, assurance and vouchers on unrelated existing lines. Let established cart rules govern intentional changes (for example clearing group negotiation when adding a line); show relevant customer feedback.
- [ ] Provide PDP fallback for unsupported option combinations. Keep keyboard dismissed appropriately while selecting, then restore search position on cancel/back. No automatic variant choice hidden from the customer.
- [ ] Verify regular cart screens, merchant scope, persistence/hydration and native checkout-generation recovery. A double tap or stream replay cannot duplicate a single confirmed action; intentional later quantity changes still work.
- [ ] Run existing cart merge/reprice/checkout-generation suites and checkout UI regression suites on both platforms. Mock providers for deterministic tests; use authorized sandbox QA for genuine end-to-end payment if requested. Do not issue real payments for plan validation.
- [ ] Review and commit. Enable separately only after search-to-cart-to-existing-checkout QA passes.

## Task 6: Renderer trial and delivery gates

**Files:** If justified after initial usage, create an isolated fixture-based json-render trial with shared domain fixtures and separate web/native registries. Keep it outside production routing until evaluated. Update research/decision docs with results and pinned compatibility.

- [ ] Compare existing event renderer against json-render using the same ProductResults, AppliedFilters, ClarificationChoices, ProductComparison and CartSummary fixtures. Confirm custom components, streaming cancellation, accessibility, bundle impact and installed React/Expo/SDK compatibility. Do not adopt a framework solely to achieve keyboard movement or image-independent text.
- [ ] Keep first production implementation unless the trial demonstrates a concrete maintenance/UX benefit. A2UI adapter is deferred until interoperability is required and the selected renderer passes the chosen protocol version fixtures.
- [ ] Run package lint/typecheck/tests; shared runtime changes require full monorepo checks including consumers under repository instructions. Report existing failures separately. Run `coderabbit review --agent -t uncommitted` before committing/shipping and address valid critical/high findings.
- [ ] Native QA uses repository emulator/install/Metro/dev-client scripts and host safeguards. Check VoiceOver/TalkBack, large text, reduced motion, browser/native Back, slow images, network loss and failed assistance.
- [ ] Record first usable result time, actions/time to choose and buy, abandonment, exact-selection errors and cost per assisted session. Keep analytics distinct from actual successful orders and preserve existing submission tracking semantics.
- [ ] Release in stages: baseline UI, comparison, optional assistance, then selection shortcut. Flag-off must immediately restore conventional discovery without clearing carts, comparison choices or checkout sessions.
- [ ] Obtain only the existing necessary release approvals after concrete checks; keep source validation, review, merge, deployment, app release and customer verification distinct.

## Test commands

Use pnpm and current app manifests. Examples from the current worktree:

- Native: `pnpm --filter @baci/mobile-storefront exec jest components/search stores/comparison-store.test.ts __tests__/app/compare --runInBand` (include new paths as created).
- Web: `pnpm --filter @baci/web exec vitest run 'src/app/(storefront)/[slug]/(catalog)/(listing)/search' src/components/storefront/ogabassey/components/ProductComparisonTable.test.tsx`.
- Shared: `pnpm --filter @baci/shared exec vitest run src/lib/product-comparison.test.ts src/lib/shopping-assistance.test.ts src/lib/shopping-assistance-stream.test.ts`.
- Full shared-impact gate: `pnpm turbo lint typecheck test`, following current repository validation rules. Do not weaken authority/evidence tests to make the suite green.

## Completion criteria

A shopper can use conventional search or optional assistance, compare selected real products, inspect/confirm an exact purchasable option, and reach the normal checkout with the correct existing cart. AI failures never disable search/cart/checkout. No second cart, generated payment form or alternate order lifecycle exists. iOS, Android, mobile web and desktop behavior is verified separately. Renderer trial is optional and not a prerequisite for a useful first release.

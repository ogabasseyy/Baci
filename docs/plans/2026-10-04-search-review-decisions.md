# Search review decisions — PR 3616

## Product choices retained

- **Assurance:** the owner explicitly requested default-on for Ogabassey carts. Other merchants remain opt-in, and an explicit false survives adding, merging and rehydration. The native configuration intentionally defaults the whole storefront to Ogabassey; this does not make another configured merchant default-on. Both carts disclose the optional fee and how to remove it. Web totals cover default-on, opt-out and merged quantities; native stored opt-outs also have a rehydration regression.
- **Search outline:** the owner explicitly requested a red search outline. The Ogabassey override stays red, independently of changes to its general merchant palette. Other merchant forms follow their primary theme color.
- **Comparison capacity:** native intentionally allows three products to keep its comparison table manageable on a phone; web permits four in its responsive table. Selections are local to each client session; they are not transferred between platforms. Native requires removal at capacity, while web explicitly announces replacement of the oldest selection. This is an intentional presentation difference.
- **Pagination:** RPC offsets address ranked slots. A product disappearing during hydration does not compress those slots. `totalCount` therefore retains the RPC total for page arithmetic; the shopper-visible `count` subtracts skipped hydrated rows and is clamped to zero. Reusing the reduced display count for offsets could hide remaining ranked products.

## Request-contact access

The delivered product-request notification targets one merchant and is in-app only. Its contact is retained for follow-up, as disclosed by both request forms. Deleting the durable request erases its delivered notification through the existing trigger.

The current notification RBAC migration, `20260805150900_harden_notification_rbac_and_realtime.sql`, permits recipient reads only when the parent notification is sent and the caller has access to its recipient merchant. Anonymous users and unrelated merchants cannot read these rows. Authorized merchant staff may read them, and platform administrators with the explicit `notifications.manage` permission have management access. Thus access is not literally owner-only.

The disposable regression fixture executes the actual RBAC migration and tests anonymous, owner, authorized staff, unrelated user and explicit administrator access. Access helpers are fixture inputs modeling the existing authorization contract. This verifies the migration's policy behavior, not a fresh inspection of a deployed database.

## Corrections

- Comparison refresh cache identity includes the selected variant, offer and condition.
- The shared keyboard dock reports its measured height and safe-area clearance to the search body, including while the keyboard is open.
- Web refinement navigation resets an unsubmitted query draft to the committed query, keeping the input and filtered results consistent.
- Optional assistance is reachable from an explicit suggestion-area action on native and web. Native uses its configured assistance URL; web uses the existing server feature flag. Requests do not run per keystroke, proposals require a separate Apply action, and failures leave ordinary search available. No environment flags were enabled by this change.

## Round 5 follow-ups (accepted risks)

- Facet RPC merchant enumeration is accepted. `get_storefront_search_available_facets` takes a merchant id and is executable by anon, but it aggregates only published, active candidates from the same candidate function the listing uses (plus RLS as SECURITY INVOKER), so it exposes a subset of what the public listing already shows. The app path resolves slug to id server-side; direct callers learn nothing beyond the public catalog.
- Historical migrations stay non-idempotent by design. Frozen files cannot be edited (append-only plus replay hash pins), a follow-up cannot retroactively guard them, and the version tracker with transactional application already prevents partial replays. The AGENTS.md guard clause governs new migration authorship.
- Cart merge applies last-write-wins for an explicit incoming assurance choice on all three providers; a merge add without a choice preserves the stored line choice.

## Round 6 follow-ups (Codex on c28fa275e1)

- Intake key scope is module-confined, not DB-role-confined. `server-intake-client` never hands out the service client and exposes only the submit RPC; the dedicated `SUPABASE_STOREFRONT_INTAKE_KEY` gives rotation independence but still bypasses RLS like every branded service client. A restricted Postgres role would need a new migration plus grant review and stays author triage.
- Comparison refresh availability comes from the serialized-aware `get_storefront_search_price_options` projection, the same one search uses — raw hydrated stock math marked purchasable serialized options unavailable. RPC errors fail closed to the couldn't-refresh status.
- PDP offer/variant/condition/image selection plus derived price/stock moved to `use-product-offer-selection`; the client drops from 1117 to ~783 lines with no behavior change (PDP suite green).

## Round 7 follow-ups (Codex on 1da6f04ad0)

- Suggestion budgets are currency-aware: NGN keeps fixed ₦100k steps, other currencies round the median to its own magnitude with an Intl label (plain-code fallback for unknown codes). Web threads the merchant currency; native takes an optional currency defaulting to NGN because the native Merchant type has no currency source (full native multi-currency stays out of scope).
- The 398-line offer hook is split into `product-selection-utils` (142), `use-product-route-selection` (56), and the orchestrator (298), each with a colocated suite covering route parsing, offer honoring/dismissal, reseeding, variant transitions, and pricing.
- The comparison tray mounts on empty results (it self-nulls without intent plus two selections); snapshots retain brand/condition fallbacks that the tray uses when refresh misses an item.
- Web refinement panel gains the minimum-rating filter mirroring native; `minRating=0` counts as absent everywhere (SQL treats it as a no-op floor, chips show nothing, intake suppression agrees).
- Matched-option refresh suppresses the parent strike-through exactly like the search card, so the compare table shows no false discount.
- Snapshot condition is a graceful enum mirroring the ogabassey Product union: unknown stored values drop to undefined (tray falls back) instead of failing hydration and losing the item.

## Round 8 follow-ups (Codex on eebfafd78c)

- Refinement fields split: `RefinementGroup` moves to its own module with a colocated suite (291 + 37 lines).
- Desktop refinement commits carry `minRating`; native request-id generation moved inside the submit try (proven wedged on old code, recoverable on new).
- New migration `20261004130000` relaxes the price-options predicates: product-level offers emit for attribute-variant products (still suppressed when variants carry canonical conditions, mirroring the PDP axis rule), and the inventory-qualified base row emits regardless of alternate offers. Validated on scratch Postgres across five catalog shapes (base+offer, storage-variants+offer, condition-axis+offer, plain, OOS parent); the `anon` GRANT noise is a scratch-role artifact. Registration against the live project stays author triage with the other unregistered PR migrations.

## Round 9 follow-ups (Codex + Muse on f05f806ef1)

- Migration `20261004150000` pulls standalone offer rows back out of the shared projection for variant products: native purchase state ignores condition offers on variant products and prices the resolved variant, while web charges the matched offer — no single pair price satisfies both PDPs, so emitting them guarantees a card/PDP mismatch on one platform. The base-row widening from Round 8 stays.
- The same migration restores the nullish-unmanaged contract (`IS NOT TRUE`) the option guards regressed from the original projection; NULL `manage_stock` rows are purchasable again, matching hydration and both PDPs. Re-validated on scratch Postgres across six shapes (adds legacy NULL stock).
- Muse inbox-XSS report adjudicated invalid with two routes of evidence: both merchant-inbox renderers interpolate React-escaped text with no `dangerouslySetInnerHTML`, and delivered rows carry `sent_at` so the scheduled-notification worker never re-processes them. Native "resolved merchant" ask likewise invalid: the app is single-merchant-per-build and `useMerchant` resolves from the same build config the gate reads.
- Settled comparison-refresh failures now mark every cached id unavailable instead of presenting stale prices as current; saved matched options drop the parent strike-through like the search card; both assistance hooks generate request ids inside the guarded block.
- Assurance default/merge policy extracted to `cart-assurance-policy` shared by both web providers with a colocated suite; native prefill re-syncs when the query changes while the sheet is closed.

## Round 10 follow-ups (Codex + Muse on dffcb166ac)

- Toolbar reveal gains its colocated suite (visible/hidden touch + a11y states, measured-height collapse).
- "Ask about this search" renders only when the flag is on AND the merchant is the configured agentic tenant, matching the route's 503 contract; native needs no gate (single-merchant app resolving to the configured tenant).
- Brand facet requests strip `processor_filter`, which the brands RPC cannot accept; brand options stay processor-unscoped instead of failing resolution.
- Muse contact-PII/RLS ask verified: `merchant_notifications` selects are merchant-owner-only and `notifications` selects require an owned link (or platform admin). Native assurance-flag divergence and processor-URL validation stay product decisions (no flag infra exists on native; facet-gated invalid states risk false negatives during facet outages). Comparison identity documented as product-keyed at both dedup sites.

## Round 11 (Muse on 239bd8cc05 — all adjudicated, no code change)

- Assurance-in-charged-total verified: both web providers add `assuranceCost` into `cartTotal` (`storefront-cart-provider.tsx`, `use-cart.tsx`), the Order Summary renders `cartTotal`, and native `checkout-order-builders.ts` computes `total = subtotal + deliveryFee + assuranceFee + taxAmount`. Per-line itemization discloses the fee on both platforms.
- Contact-PII retention stays a product decision: forms disclose inbox storage, deletion propagates via `erase_storefront_product_request_inbox`; no TTL/redaction by design for a public intake endpoint.
- Web `count` (adjusted) vs `totalCount` (raw) split is intentional and correct: the pager uses the raw total because skipped rows stay ranked (using the adjusted count would undercount pages and strand rows — the exact failure Codex flagged on native), while the result summary label uses the adjusted count. Short pages occur only under concurrent mid-read deactivation and self-heal on next navigation.

## Round 12 (Codex on a81f0ee1d5 — CX-37..CX-40, all fixed with tests)

- CX-37: new `refined-search-rpc.test.ts` colocates coverage for the shared RPC helper (max-offset contract pinned at 1980, arg building, row validation) per the mandatory-coverage rule.
- CX-38: simple-PDP reseed now falls back to the normalized parent condition when the route condition disappears (removed offer or `offer_id` leaving the URL), instead of keeping the stale offer condition and falling through to another same-condition offer. Both halves proven red pre-fix.
- CX-39: native comparison facts refetch on false-to-true screen-focus transitions (`useIsFocused`, matching app convention); mount stays single-fetch. The compare screen test mocks the hook, so only the hook suite needed the router mock.
- CX-40: the no-results panel hides product intake when the query normalizes to no catalog term (`?q=!!`), using the same `buildProductSearchQuery` normalization as native search; the intake schema would 400 such queries for lacking a letter or number.

## Round 13 (Muse on 20f71f7475 — all adjudicated, no code change; Codex quota-blocked)

- No critical/high; 3 lows + 1 medium, all repeats: assurance default-on scope (product decision), contact PII in inbox rows (inbox escaping already verified, erasure path exists), merchant-budget exhaustion (PR-declared deferred item with IP-throttle follow-up).
- Sort silent coercion (`?sort=bogus` → `relevance`) adjudicated intentional: `relevance` is the default sort, so coercion equals omitting the param — no misleading results, unlike brand/price miscasts.
- Rebased onto main (behind-base hook); inventory snapshot regenerated on the rebased HEAD via the sanctioned CLI with the binding SHA updated.
- Codex trigger on 20f71f7475 returned "usage limits for code reviews" — awaiting quota recovery to complete the loop.

## Round 14 (Codex on 20f71f7475 — CX-41..CX-43, all fixed with tests)

- CX-41: PDP selection handlers extracted to `product-selection-handlers.ts` (115 lines) with a colocated factory suite; the hook drops 306 → 255 lines, back under the 300-line modularity limit.
- CX-42: the assistance query rule (trimmed 2–120 chars + catalog term) is now a single shared `searchAssistanceQuerySchema` used by the request schema, the proposal schema, and both storefront gates — 1-char, 121–200-char, and punctuation-only queries no longer advertise an action that can only 400. Native had the same >120 hole (no input cap); fixed at the same time.
- CX-43: both condition selectors merge the draft condition into the option list exactly like the processor selectors, so a facet value that disappears mid-session still displays instead of falsely showing "Any condition".

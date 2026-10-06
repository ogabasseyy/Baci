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

## Round 15 (Muse on 73c44470b9 — verified/tested, no behavior change; Codex quota-blocked)

- Compare-refresh low is an explicit no-action note (path verified, no stale-price add found).
- Saved-match-identity low answered by verification: web PDP accepts a routed offer id only when it names one of the product's live offers (covered by test), and native `use-product-detail-route-data.ts` applies the same live-offer `.some()` guard with shared-resolver variant fallback — unknown/stale ids fall back, never crash or misprice.
- Notification-PII medium answered with a new test: `notification-detail-content.test.tsx` proves an HTML payload in the persisted message renders as inert text (no `img` element); both inbox renderers use React-escaped interpolation with no `dangerouslySetInnerHTML`. (Test held uncommitted — see below.)
- Assist-wiring low answered: proxy bucket covers `/api/search/assist` (5/min per IP) and the tenant budget runs on Upstash Redis shared across instances, failing closed on outage. Assurance-fallback medium stays a product decision (single-merchant app).
- Codex trigger on 73c44470b9 returned "usage limits for code reviews" — loop paused. The inbox test is held uncommitted to fold into the next fix commit; re-trigger once after quota recovery.

## Round 16 (Codex on 73c44470b9 — CX-44..CX-46, all fixed with tests)

- CX-44: saved links omit the snapshot condition when an exact variant/offer id exists, and native route-data derives the route condition from the live offer on ID-only links (mirrors web) — a merchant recondition after saving can no longer reject the identified offer into a wrong same-condition fallthrough. Variant links were already safe (shared resolver drops conflicting conditions). The saved-navigation test contract is updated to match; web has no saved-match forwarding.
- CX-45: both category selectors append an "Unavailable category" fallback for a draft id missing from facets (the name is unknowable post-deactivation; ids are UUIDs), so a deactivated-but-still-applied constraint displays truthfully instead of "All categories".
- CX-46: the new assurance disclosure line uses `text-store-background-text/55` instead of hardcoded gray; the cart suite pins the theme class. Pre-existing gray/red lines untouched (out of diff).
- Folded in the held Round 15 inbox-rendering test.

## Round 17 (Muse on 2c87319dac — sentinel removed, rest adjudicated; Codex quota-blocked)

- Removed the dead `storefront-public-intake` service sentinel (brand, type, overload, key/error branches, manifest mapping, and its 2 factory tests): it was this PR's own leftover, has zero production callers (live intake uses anon key + access token), and its "service-role" branding misdescribed a restricted JWT. Verified no reference remains and the manifest verifier suites stay green.
- Budget-exhaustion medium stays deferred per the PR description (proxy IP gate is the only rotation brake; needs the 429-spike alert before merge). Assurance-fallback medium stays a product decision (single-merchant app). Stale-row count/totalCount low re-adjudicated: the empty-page probe corrects the one-redirect overstatement by design.
- Comparison cap 3-vs-4 documented as intentional per-form-factor divergence: web fits 1 main + 3 comparisons ("UI sanity"), native side-by-side fits 3 ("up to 3 products"); both are product-id keyed and session-scoped. Aligning would shrink one platform's UX without a product decision.
- Codex trigger on 2c87319dac returned "usage limits for code reviews" — loop paused again after pushing the sentinel removal.

## Round 18 (Muse on 7223ae1bcd — honor path proven, rest adjudicated; Codex still quota-blocked)

- ID-only-honor medium disproven with a committed integration test: `use-product-detail-route-data.test.ts` renders the real route-data + selection hooks across a product load and asserts the honor path resolves the identified multi-offer id with the live-derived condition. No first-paint gap exists — selection seeding runs during render (render-phase setState re-renders before commit), so the committed paint already carries the synced condition. `findMatchingConditionOffer`'s null-on-mismatch is correct for genuinely stale params.
- Facet fail-safe low invalid on both platforms: web's loader catches facet failure immediately and degrades to empty facets (`facetError: true`, documented in code); native consumes facets via `data?.x ?? []` with independent error/retry, results unaffected. The `throw` is the designed signal at both call sites.
- Assurance/budget mediums and cap low remain as adjudicated (product decision, deferred with alerting prerequisite, documented per-form-factor divergence).

## Round 19 (Muse on a6f2b89786 — all repeats, no code change)

- Budget-exhaustion and assurance-default mediums: deferred / product decision as adjudicated (totals inclusion verified Round 11).
- price-0 masking low: covered by the committed "unavailable facts never render zero price" test. PII low: inbox text-rendering test (Round 15) + merchant-owner-only RLS. isLocalhost low: private-range coverage pinned by test.
- No new actionable items; note held uncommitted for the next fix commit.

## Round 20 (Codex on a6f2b89786 — CX-47..CX-51, all fixed with tests)

- CX-47: search cards badge the matched condition beside the matched price (null for matched-new, mirroring the parent single-new rule); non-search callers without `searchMatch` keep parent-derived badges.
- CX-48: draft type/helpers extracted to `search-refinement-draft.ts` (31 lines) with a colocated round-trip suite; fields module drops 307 → 281 lines. Five consumer files re-pointed.
- CX-49: new append-only migration folds brand filters case- and trim-insensitively in the single live candidates function (public was moved to the private schema; all wrappers/facets delegate there). Validated on scratch Postgres against the real migration file: old body `{apple}`→0 rows (bug), new body `{apple,Apple,APPLE,' apple '}`→1, `{Samsung}`→0, `{}`/`NULL`→fast path intact, NULL-brand rows excluded under filter but included unfiltered (9 probes).
- CX-50: compare navigation keys on search intent (downstream intent + count>=2 gates do the rest) instead of result length, so zero-result refinements no longer strand an active comparison session.
- CX-51: assurance toggle row extracted to `cart-assurance-row.tsx` with a colocated suite (copy states, theme class, toggle callback); cart page drops 457 → 429. The page remains over 300 on pre-existing content — a full split is out of scope; the new/touched logic now lives in a compliant module. Note: `ogabassey/**` is biome-ignored by config, so the extraction is typecheck- (not lint-) covered like its parent.

## Round 21 (Muse on d90662b976 — cart merge adjudicated pre-existing, rest repeats; Codex quota-blocked)

- Native cart-merge medium adjudicated out-of-diff: the `{...existingItem, ...incomingItem}` spread predates this PR (#2142 refactor); the PR touched only the `hasAssurance` line in both merges. Direction-correctness is ambiguous (incoming PDP data is live-viewed, stored may be older; id/quantity/negotiation/rate are explicitly preserved), and web-vs-native merge divergence is likewise pre-existing — a product decision for the author, flagged here.
- Assurance/count-identity mediums+lows all repeats of adjudicated items (fallback scope, adjusted-vs-raw pagination, product-keyed comparison).
- Codex trigger on d90662b976 returned "usage limits for code reviews" — loop paused; note held uncommitted for the next fix commit.

## Round 22 (Codex on d90662b976 — CX-52..CX-53, both fixed with tests)

- CX-52: search-result product links omit the snapshot condition when an exact variant/offer id is present (web card + native search navigation), extending the CX-44 saved-link rule to direct search taps. Compare/saved-storage/compare-refresh forwarders audited and left intact: snapshots refresh to live facts before navigation, and storage must retain the condition for condition-only entries.
- CX-53: the no-results intake gate now requires the intake schema's query rule (trimmed 2–120 + letter/number) in addition to a catalog term, so 1-char and 121–200-char no-result pages no longer advertise a form prefilled with a value the API would 400.

## Round 23 (Muse on ac185d81f1 — compare nav fixed, tray basis adjudicated; Codex quota-blocked)

- Native compare navigation now omits the snapshot condition with exact ids (my earlier audit wrongly assumed fresh-only facts; refresh failure and unavailable rows fall back to the snapshot, so the pairing could go stale). Covered by a compare-screen navigation test.
- Web tray price-basis medium adjudicated: the tray explicitly labels "Current parent starting prices" and marks matched rows "Matched option — verify on product page", satisfying the finding's own remediation (mark unverified rows); deep links already omit condition with exact ids. Assurance/budget items remain as adjudicated.

## Round 24 (Muse on 033426237c — UUID filtering added, is_published adjudicated; Codex quota-blocked)

- Comparison refresh now drops malformed session ids before the facts query and skips the round-trip when none valid remain (PostgREST rejects empty `in`): one poisoned sessionStorage entry can no longer fail the whole tray refresh. Existing hook tests moved to UUID ids; malformed-mix and all-invalid cases covered.
- The is_published half adjudicated negligible: the platform products SELECT policy itself exposes active rows regardless of publish state (pre-existing, out of scope), the data is public catalog, and staleness self-corrects on navigation. Budget medium remains deferred with alerting prerequisite.

## Round 25 (Muse on 79ab9e3557 — schema UUID + skip cap, both fixed; Codex quota-blocked)

- Comparison snapshots validate match ids as UUIDs at the schema, dropping malformed fields (parent-basis item kept, matching the condition precedent); hydration already drops invalid entries individually, so no whole-list wipe. Strictness note: zod `.uuid()` enforces RFC variant bits while the facts-hook regex is format-only — both correct for their purpose (PostgREST accepts any format-valid UUID; real v4 ids pass both).
- Refined page skip-ahead capped at 3 sequential fetches; the capped page keeps its next offset so list pagination still advances instead of fanning out on poisoned pages. Budget/assurance mediums remain as adjudicated.

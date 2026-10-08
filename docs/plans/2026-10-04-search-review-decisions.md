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
- New migration `20261004131000` (renamed from 20261004130000 after a main-collision in Round 34) relaxes the price-options predicates: product-level offers emit for attribute-variant products (still suppressed when variants carry canonical conditions, mirroring the PDP axis rule), and the inventory-qualified base row emits regardless of alternate offers. Validated on scratch Postgres across five catalog shapes (base+offer, storage-variants+offer, condition-axis+offer, plain, OOS parent); the `anon` GRANT noise is a scratch-role artifact. Registration against the live project stays author triage with the other unregistered PR migrations.

## Round 9 follow-ups (Codex + Muse on f05f806ef1)

- Migration `20261004151000` (renamed from 20261004150000 in Round 34) pulls standalone offer rows back out of the shared projection for variant products: native purchase state ignores condition offers on variant products and prices the resolved variant, while web charges the matched offer — no single pair price satisfies both PDPs, so emitting them guarantees a card/PDP mismatch on one platform. The base-row widening from Round 8 stays.
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

## Round 26 (Muse on 250c7fdc7a — namespacing/image verified, no code change)

- Storage-key fallback verified safe: both storefront mounts (search + category pages) pass `storageNamespace={merchant.id}`; the global key is unreachable from storefront flows, so no cross-merchant tray pollution.
- Snapshot image verified unrendered: the tray persists `image` but renders name/price/condition/brand/category/specs only — no XSS vector through the loose string field.
- Assurance/budget/PII/count mediums+lows all repeats of adjudicated items.

## Round 27 (Codex CX-54..CX-58 on 250c7fdc7a — all five fixed)

- CX-54 (P1): search/compare match-param building extracted to `lib/product-match-route-params.ts`; search.tsx 301→288 lines, compare 94→80. Helper tests + both nav call-site tests.
- CX-55: empty first page with a next offset now renders an explicit "Load more results" continuation (hasMore threaded search→View→Body) instead of the dead-end empty state; the skip cap from Round 25 is kept, satisfying both reviewers. Body test covers press→loadMore.
- CX-56: matched base rows restore the RPC-refreshed live condition instead of the parent's "New & Used" label (compare table reads product.condition). Base-case assertion verified red pre-fix, green post-fix.
- CX-57: final brand-folding migration registered in both replay registries with its verified sha256; replay pin + manifest suites green (25/25). May clear the DB Replay CI red — verify on checks.
- CX-58: ID-less base matches carry explicit `match_base=1`; the PDP suppresses condition-offer resolution while the selection still equals the entry one (resolver + effective-price flags, route-data boolean), so the advertised base price survives. A shopper-picked condition re-enables offers. Saved-screen links pass ids only and are unaffected; base matches saved without ids still open with PDP-default selection (indistinguishable, noted, out of scope).

## Round 28 (Muse on fcaa9c5b21 — 2 repeats + 1 new low adjudicated; Codex quota-blocked)

- Intake contact-rotation and assurance default-on mediums are repeats of adjudicated items; no code change.
- New assist-tenant Host-spoofing low adjudicated invalid: `resolveAgenticChatTenant` pins the tenant to the server-configured slug (`resolved.merchant.slug !== configuredSlug` → null → 503), so a spoofed Host can only deny, never borrow another merchant's 60/min budget or branding. The resolver is pre-existing shared code (#3482, untouched by this PR); the rate limit keys on the resolved pinned merchantId.
- Codex trigger on fcaa9c5b21 returned usage-limits (single trigger, no spam); Jules fast-mode also failed to produce a body. Loop paused awaiting Codex recovery.

## Round 29 (Muse 4 findings — 1 test fixed + 1 test added, 2 adjudicated; rebased onto 3f0ac0a9e0)

- Rebase onto 4a4e4fddd6 (#3620 savings) then 3f0ac0a9e0 (#3618 GTIN/MPN): kept both sides for piggyvest/search index exports, service sentinels, and authority manifests; recomputed the service.ts sha256 pin for the merged file; skipped 4 obsolete inventory-refresh commits and regenerated the snapshot once via the sanctioned CLI (568 rows). The rebase stalled 30m on a vi COMMIT_EDITMSG (GIT_EDITOR=true thereafter).
- isInCompare race: no functional bug — mutations hydrate on demand with a chained dup-guard (same-tick safe), and state-only reads match the server snapshot by design (storage reads in render would hydration-mismatch). BUT the test claiming pre-hydration selected reads was vacuous (`toHaveTextContent` is substring: 'unselected' contains 'selected') and contradicted the genuine empty-until-hydration test. Replaced it with a real first-tap regression test (stored id + add pre-hydration → exactly 1 row, no replacement), red-proofed by breaking the guard.
- Inbox XSS: merchant card renders `{title}`/`{message}` as JSX text (no dangerouslySetInnerHTML); no merchant-inbox renderer is added by this PR (only the admin text test + RLS tests). Added the missing merchant-card text-rendering test (script/img/b payloads inert).
- Assurance fallback-identity medium adjudicated repeat: build-default Ogabassey identity is documented product behavior shared with requests/repairs; runtime merchant plumbing into the sync cart store is author scope.
- count/totalCount low adjudicated: contract intentional and documented — count (adjusted) is the truthful display total, totalCount (raw) drives paging so stranded rows stay reachable; the summary formatter and empty-state branches verified consistent. Displaying totalCount would overcount rendered items.

## Round 30 (Codex clean on ad352df4cc; Muse rounds on 647d0856a3/ad352df4cc — bare-flag fix + docs, rest adjudicated)

- Codex reviewed ad352df4cc with no major issues and zero inline comments. Loop continues for a same-head double-clean.
- Bare match_base low FIXED with a real bug: suppression keyed on selection===route, but a condition-less entry defaults the selection away from null, so bare flags never suppressed. Predicate now keys on !hasCustomizedSelection (chips are state-only and always set it) plus entry-equality-or-bare. Tests: bare suppresses at mount, any explicit pick re-enables.
- Zero-price invariant low: documented MUST-honor-unavailableIds on the hook (verified CompareScreen→View→Table thread it); no behavior change.
- Unclamped single-page total low adjudicated: single caller (wrapper line 109, grep-verified), wrapper clamps before return — the raw value never escapes, so Math.max would be dead hardening.
- Contact-PII medium adjudicated: intake forms on both platforms disclose inbox storage ("store's inbox so the merchant can follow up"), erasure trigger deletes the inbox copy with the request, RLS tests pin owner scoping, merchant card renders text (Round 29 test).
- AI tenant-cap medium adjudicated product decision: public route is 404 unless STOREFRONT_SEARCH_ASSIST_ENABLED=true (dev-only today), plus 5/min IP and 60/min tenant caps with 12s timeout; tightening/alerting belongs to the production enablement plan.
- Planning-docs local-paths low: scrubbed /Users/mac paths and LAN IPs to ~/... and placeholders in ledger/phone-test/activation; verify-sql.mjs keeps its generic env-overridable /tmp default (functional, not identity leakage).
- Merge-gate high is process (PR stays draft): native typecheck is green in the 10/10 monorepo gate on this base (no slide-fixture errors observed); changed-area suites re-run on the rebased head (mobile 84, web 46, shared 12, manifests/service/inventory 27+1).

## Round 31 (Muse on dcf082bd30 — 3 repeats adjudicated, no code change; Codex pending)

- Assurance fallback medium: repeat of Rounds 23-30 (documented build-default product behavior; web/native parity difference already disclosed).
- PII retention/TTL medium: retention-via-inbox-row + erasure-on-delete + owner RLS + form disclosure + text-safe render all verified; a TTL/cron purge policy is a new ops feature, author scope.
- Zero-price low: explicitly "no live bug"; acknowledges the Round 30 invariant JSDoc. A non-numeric sentinel/type change would ripple through Product consumers for zero live benefit — disproportionate, declined.

## Round 32 (Codex CX-59..CX-60 on dcf082bd30 — both fixed)

- CX-59: saved ID-less matches now forward match_base=1 with the condition. Reverses the Round 27 "indistinguishable" note: match_* fields persist ONLY from searchMatch (saved-store grep-verified), so condition-without-ids necessarily denotes a base-row match. Saved nav test updated.
- CX-60: variant-matched search cards suppress the parent storage/RAM subtitle (empty detail hides the element); base/condition matches keep parent specs. Single render site (grep-verified); card test encodes the 128GB-price-vs-256GB-subtitle scenario both ways.

## Round 33 (LOOP CLEAN on 8f0f504257 — Codex no-issues + 0 inline; Muse 3 repeats adjudicated)

- Codex: "Didn't find any major issues. Swish!" with zero inline comments on the head.
- Muse medium (assurance totals) + low (global compare key) + low (zero-price discipline): all repeats of Rounds 26/30/31 adjudications (documented product behavior; namespaced mounts verified; invariant JSDoc + single wired consumer). No critical/high; no code change.
- Note held uncommitted: committing would move the head past the double-clean commit for docs only.

## Round 34 (merge-ready: 2 threads resolved; 3 migration collisions renamed; CI root-caused)

- Conversations: paginated audit (113 threads) found only CX-59/CX-60 unresolved; both fixed in 8f0f504257 and verified present — resolved, 0 remaining.
- CI red root cause: our migrations collided with main's savings/push versions (04130000/04150000/04170000) — failed DB Replay, Misc, and web shards 2/3/4/6 with duplicate-version errors. Renamed ours to 04131000/04151000/04170500 (order-preserving; 0415 depends on 0413), updated 3 registry/test files + 1 SQL test include + 1 in-file cross-ref, recomputed the one sha changed by the comment edit. Replay suites green locally (pin 1, gigl 2, manifest+ordering 16). Two older duplicate pairs are pre-existing on main and untouched.
- Checkout e2e red is infra-only: "Install browser engines" exceeded the 20m job cap before the suite ran; reruns with the push.
- Follow-up: shards 4/6 failed on Task 6 service.ts hash drift — the rebase had pinned an intermediate merged hash, but the branch's final service.ts is byte-identical to main (sentinel added then removed), so all 3 pin sites restored to main's 140038df. Live/repository/materialize suites green locally (14+15).

## Round 35 (Codex CX-61..CX-63 on f1263821e2 — all three fixed)

- CX-61 (P2): new append-only migration 20261008090000 rejects null/blank/>80-char processor_filter with invalid_processor_filter before the candidate query (80 bound mirrors the app criteria schema; no in-repo caller sends null). Registered in both replay registries with verified sha. Scratch-Postgres validated: 4 invalid probes raise, valid + boundary-80 probes pass the guard (6/6 as designed).
- CX-62 (P1): PDP "View Cart and Checkout" no longer bypasses the cart assurance toggle — href /checkout → /cart, matching the button's own label. Verified the hole was unique: sidebar has the toggle, native has no PDP→checkout path, success-page links are post-purchase. PDP client test pins href=/cart.
- CX-63 (P2): shared isSameFacetChoice/deduplicateFacetChoices in @baci/shared (facet spellings win); web + native brand lists and checkbox toggles normalize trimmed/case-insensitive. Shared (2 new), web + native component tests pin Apple/apple merge both ways. Processor radios/selects left as-is (single-select, no stuck-constraint shape; noted follow-up).

## Round 36 (Codex CX-64..CX-72 on 5de8b3daf1 — gate fix + guard migration + 8 test splits)

- CX-64 (P1): native EmptyState request gate mirrored web exactly (productRequestSchema.shape.query + normalizeSearchInput) instead of trim>=2, so invalid-but-long touch input no longer reaches the network. EmptyState test 4/4.
- CX-65 (P2): append-only migration 20261008100000 reorders the brand-guard length check before normalization initializers (CPU-only; behavior unchanged). Registered with verified sha; scratch-Postgres validated 6/6 with normalizers absent.
- CX-66..CX-72 (P3): split all 8 oversized test modules along thematic seams with per-file duplicated mocks (repo precedent): native use-comparison-products 559→3-way, web product-detail-client 549→4-way (route-hydration/cart-quantities/cart-matching), search 362→2-way, v2-comparison-context 378→2-way (hydration), cart-store 400→2-way (assurance), search-comparison 386→2-way (presentation), SearchScreenView 399→2-way (keyboard), pagination 301→2-way (analytics). All files ≤300; counts preserved (native 59, web 38 across affected suites).
- Proactive sweep: the only other PR-touched tests >300 are storefront-cart-provider (615) and use-cart (597), both pre-existing >300 on main with +102/+66 PR lines — left unsplit (minimal blast radius).
- Gates 10/10; biome unused-import fallout from the splits auto-fixed (safe fixes only).

## Round 37 (Codex clean on 8f9dee30ca; Muse 2 med + 4 low — 2 fixed, 4 adjudicated)

- Codex: "Didn't find any major issues. Nice work!" on 8f9dee30ca with zero inline comments (posted as an issue comment, not a PR review — poll both APIs).
- Muse medium match_base FIXED (web parity with native CX-59): web cards/comparison forwarded only `condition` for ID-less matches, so the PDP fallthrough resolved a same-condition offer price instead of the advertised base price. Writers now forward `match_base=1` for ID-less matches (comparison requires match context — liveMatch or snapshot condition — so non-search entries keep bare links; the pre-existing bare-href test pins that); `use-product-offer-selection` suppresses the fallthrough until an explicit condition pick (ignored-flag + seed-key reset, mirroring native). Tests: base price kept with a live same-condition offer, explicit pick re-enables, writers forward/omit correctly.
- Muse low processor-EXISTS FIXED: the unfiltered price-options EXISTS in `search_storefront_products_processor_refined` can never filter (every candidate row already carries a priced option) — pure per-row dead weight. Append-only migration 20261008110000 drops it; scratch-Postgres equivalence proven (identical rows/total) and all 4 guards still raise (6/6). Muse's "can diverge" half is wrong (a weaker predicate cannot filter), the redundancy half is right.
- Muse medium assist-budget: repeat of the Round 30 AI tenant-cap adjudication (dev-only 404 + 5/min IP + 60/min tenant; tightening is production-enablement scope).
- Muse low intake-budget + low assurance-default: repeats of the contact-PII (Rounds 26/30) and assurance (Rounds 23-31) adjudications.
- Muse low totalCount/count: adjudicated — deliberate and pinned: page count uses the raw ranked total so hydration drops don't strand reachable pages (`search-page-content.tsx` comment + "keeps other pages reachable" test); the summary line uses the adjusted count. Using the adjusted total for pages would regress that test.
- Muse next-steps staleness noted: slide-fixture errors, replay/inventory failures, and CI-pending are resolved (10/10 gates, replay suites green, CI green except in-flight shards); CodeRabbit rate_limit is a vendor-side gap, not a code finding.

## Round 38 (Codex clean on 36683f0a91 + a2bb1502d9; Muse 2 med + 2 low — 1 comment fix, 3 adjudicated)

- Codex: "Didn't find any major issues" with zero inline comments on both Round 37 heads (36683f0a91 code, a2bb1502d9 inventory refresh).
- CI: web shard 4 failed only on the inventory snapshot (match_base link changes moved the route tree); regenerated via the sanctioned CLI (568 rows, new sha 42f693b4…) + pin update, repository test green.
- Muse low stale-comment FIXED: product-request.ts claimed the submit RPC is "service-role only" but migration 20261004170500 revoked service_role and grants only storefront_intake. Comment now names the intake role.
- Muse medium snapshot-UUID adjudicated with evidence: matched ids are `uuid` at the RPC source (20261004210000 RETURNS TABLE), pass through readRefinedSearchRows as strings, and the single web writer copies searchMatch ids verbatim — so `.uuid()` matches the wire format exactly. 'o1'/'offer-open-box' exist only in test fixtures. The contract was already pinned (comparison-snapshot.test.ts: UUIDs preserved, malformed dropped with parent basis kept).
- Muse medium assurance + low PII-copy: repeats of the Rounds 23-31 assurance and Rounds 26/30 inbox-delivery adjudications (documented behavior; disclosure + erasure + RLS verified).
- Threads: paginated audit (125 total) found the 9 Round 36 threads unresolved; all fixed on the branch — resolved, 0 remaining.

## Round 39 (Codex CX-73..CX-76 on 0ae3744725 — 3 fixed, 1 adjudicated; Muse 2 med + 1 low — 1 fixed, 2 repeats)

- CX-73/CX-74 (P1) FIXED: my Round 36 "minimal blast radius" call was wrong — AGENTS.md L505-508 makes the 300-line limit mandatory. Extracted the PR-added assurance tests into use-cart.assurance.test.tsx (533/138) and storefront-cart-provider.assurance.test.tsx (514/172) with duplicated fixtures (repo precedent). Bases stay >300 on pre-existing lines, but the PR no longer grows them.
- CX-75 (P2) FIXED: processor filter compared exact while the app forwards any casing — hand-authored `processor=intel core i7` missed the canonical facet. Migration 20261008120000 folds both sides with lower(btrim()), mirroring the brand filter. Scratch-validated 5/5 (exact/lower/padded match, non-match empty, null guard raises).
- CX-76 (P1) ADJUDICATED with evidence: the category PDP does not have separate selection state — page → DefaultProductPageRenderer → DefaultProductDetailClient → the SAME ProductDetailClient, whose useSearchParams reads offer_id/condition/match_base identically on both routes. No code change.
- Muse low stale-comment FIXED at the right layer: the old migration's service-role comment is historically true for its own step, so I clarified the superseding migration (04170500 header now states the transition) with recomputed sha in both registries — no stale pins remain. The live shared-lib comment was already fixed in Round 38.
- Muse medium assurance + medium intake-rotation: repeats of the Rounds 23-31 and intake-budget adjudications.

## Round 40 (Codex CX-77 on b1fef3fd7c FIXED; Muse 1 med + 2 low — 1 fixed, 2 repeats)

- CX-77 (P1) FIXED: NULL manage_stock policy was split three ways — the PR's SQL (IS NOT TRUE) and products client (?? false) said unmanaged, while main's category resolver (?? true, #3611) and isPublicVariantPurchasable (documented platform policy: "a depleted child under a null parent is unavailable everywhere") say managed. The PR was the outlier, so the PR aligned: migration 20261008130000 flips the three price-options bypasses to IS FALSE, the products client flips to ?? true, the SQL regression pins 771→0 rows plus a new NULL+stocked positive control (774→1), and the PDP test pins managed/out-of-stock. Full SQL regression chain passes on scratch Postgres (all counts/facets/wrappers hold). Native's pre-existing ?? false is untouched (separate purchase flow; noted follow-up).
- Muse low id-cap FIXED: comparison-facts refresh capped survivors to the tray capacity (4) after dedupe/UUID-filter, with a 6-ids→4 test.
- Muse low capacity (3 vs 4): repeat of the line-7 adjudication (intentional, session-local presentation difference).
- Muse medium assurance: repeat of the Rounds 23-31 adjudication.

## Round 41 (Codex clean on 76d0c4aac6; Muse 2 med + 2 low — all 4 adjudicated; inventory regen)

- Codex: "Didn't find any major issues. Swish!" with zero inline comments on 76d0c4aac6.
- Muse medium namespace-fallback adjudicated: audited all V2ComparisonScope/V2ComparisonProvider callers — exactly 2 (category + search page-content), both pass storageNamespace={merchant.id}. The shared-key fallback never triggers in production; bleed needs a future caller to omit the prop. No code change.
- Muse low intake-substrings adjudicated: message matching is established codebase practice (discount-codes, receipts, webhooks routes) and the 404/409 mapping is pinned by route tests. A migration for distinct codes is disproportionate for the hypothetical rewording.
- Muse medium assurance + low capacity: repeats of the Rounds 23-31 and line-7 adjudications.
- CI: web shard 4 failed only on inventory drift from Round 40 source changes; regenerated via sanctioned CLI (568 rows, sha c8d77e1b…) + pin update.

## Round 42 (Codex CX-78..CX-81 on dfede7700a — 3 fixed, 1 adjudicated; Muse 1 med + 3 low — 1 doc fix, 3 adjudicated)

- CX-78 (P1) ADJUDICATED: intake-by-slug is inherent to public intake (equivalent to the victim store's own public form; no privilege escalation — RPC enforces published-only server-side). Budget exhaustion is the PR-disclosed, repeatedly-adjudicated exposure with layered caps (10/IP/h, 3/contact/h, 50/merchant/h, 24h dedupe). Host-binding is infeasible (slug-pathed default domain carries no host tenant signal) and inconsistent with every other public storefront API (search/products take client tenant ids).
- CX-79 (P2) FIXED: aligned native null-stock with the platform managed policy — product-transform's three ?? false → ?? true (browse in_stock, PDP purchase via === false checks, variant in_stock) plus the cart-stock checkout guard (!x → === false). Tests pin null+depleted unavailable and null+stocked available in both suites. Full native suite green (8306/8306). Santa chat cart (=== true) and shared getProductStockBucket (!== true) left as noted follow-ups (separate surfaces).
- CX-80 (P2) FIXED: comparison refresh now consults the price projection for every match instead of skipping id-matches missing from the hydrated row — degraded hydration no longer yields false permanent-unavailable. Test pins degraded-row + live-variant → available (22/22 across the hook suites).
- CX-81 (P1) FIXED: price-options now keys variant branches on flag-true OR sku_matrix model (NULL-safe, mirroring native isVariantBearingProduct) instead of the denormalized flag alone. Migration 20261008140000 + registry; SQL regression extended (fixture variant_model column + drift product asserting the child variant row, not the base row). Full chain passes on scratch Postgres.
- Muse low merge-undefined FIXED by documentation (Muse's own alternative): verified all undefined positions are fail-safe (fee math falsy→0, toggle || false + !flip, persistence stable) and recorded the opt-out contract in the policy docblock.
- Muse low itemization adjudicated with evidence: fee itemized in cart (per-line row), checkout quote (assuranceFeeKobo), and invoice (buildAssuranceInvoiceLineItem); order-success shows grand totals only for ALL fees (pre-existing page design).
- Muse medium intake-rotation + low capacity: repeats of the PR-disclosed and line-7 adjudications.

## Round 43 (Codex CX-82..CX-84 on dd6f738954 — all fixed; Muse 4 med + 2 low — 1 doc fix, 5 adjudicated)

- CX-82 (P2) FIXED: degraded comparison refresh now prices verified exact ids from the projection's effective_price (option?.price ?? livePrice ?? product.price) instead of the parent price. Degraded test asserts the 80 projection price, not the 100 parent price.
- CX-83 (P3) FIXED: processor choices deduplicate case-insensitively in both renderers via the shared CX-63 helpers (facet spellings win), with case-insensitive selected-state resolution (web select value resolves to facet spelling; native radio checked via isSameFacetChoice). Tests on both sides pin single-option + selected.
- CX-84 (P2) FIXED: mergeAssistedRefinements takes the committed query and resets to empty (mirroring form submission) when the proposal answers a different query; same-query proposals retain as before. All 3 callers pass their committed query (web resultQuery/query, native debouncedQuery). Shared test pins Apple/phone → Lenovo/laptop reset.
- Muse medium web-refresh-verification FIXED by documentation (Muse's own alternative): recorded the parent-basis-until-PDP contract on the facts hook and tray price block; the tray already marks matches "verify on product page".
- Muse medium zero-price adjudicated: sole consumer (CompareTable) verified honoring unavailableIds; contract documented + tested; a branded-price type would ripple without forcing new-consumer checks.
- Muse low intake-CSRF adjudicated: route uses no cookies/session/headers (no ambient authority → no CSRF vector); budget half is the PR-disclosed repeat.
- Muse assurance x2 + count/totalCount: repeats (itemization evidence Round 42; pinned reachability test covers the suggested regression — it exists).
- CI green on dd6f738954 (25 pass, 0 pending) before Round 43 push.

## Round 44 (Codex CX-85..CX-87 on e22893bdc0 — all fixed; Muse 1 med + 2 low — all repeats)

- CX-85/CX-86 (P1) FIXED: consolidated all PR-added assurance conditionals into the PR-created policy module via resolveAddedLineAssurance(incoming, existing, policy) — both oversized providers now contain only call sites (no assurance branching); the import shrinks to one name and the provider's default const is gone. Unit tests pin new-line default, merge preservation, legacy-undefined, and off-policy opt-in (62/62 across policy + cart suites). Full decomposition of the 700-line pre-existing providers is out of scope for this PR.
- CX-87 (P3) FIXED: replacement notice clears on removal and on non-replacing adds. Two tests pin both; moved to the presentation split to hold the 300-line ceiling (267/295, 14/14).
- Muse medium intake-rotation + low assurance-QA + low zero-price: repeats (PR-disclosed budgets; Round 42 itemization evidence; Round 43 sole-consumer adjudication).

## Round 45 (Codex CX-88..CX-89 on 05d190f210 — both fixed; Muse 1 med + 2 low — 1 fixed, 2 adjudicated)

- CX-88 (P2) FIXED: degraded exact-variant matches suppress parent specifications ({} → unknown cells) since only identity/price/condition are projection-verified; a 128 GB match no longer shows the parent's 256 GB. Suppression scoped to variant-id matches (offer matches share parent specs; ID-less base matches use the parent basis correctly). Degraded test asserts {}.
- CX-89 (P2) FIXED: live-match id adoption gated on ALL snapshot match fields absent — a condition-only saved base match keeps match_base=1 instead of adopting a re-filtered live variant/offer id. Test pins match_base present + no variant_id/offer_id; both link tests condensed via a shared helper to hold the 300-line ceiling (274).
- Muse medium native-assurance-gate ADJUDICATED with evidence: the only production passer of web's enableSmartCartPro is a bare (always-true) prop in storefront-shell-frame (the =false are defaults), so web's effective behavior IS default-on for Ogabassey — native matches it exactly. A native flag defaulting false would diverge from the documented product decision; defaulting true would be dead ceremony. Parity recorded in the cart-store comment.
- Muse low isInCompare-hydration ADJUDICATED with evidence: addToCompare/removeFromCompare already hydrate internally before acting (stale-source claim false); state-only isInCompare is intentional SSR parity (storage reads during render would mismatch); pre-existing path outside changed files.
- Muse low matchCondition FIXED: schema now reuses the snapshotCondition union (writers only emit new/used/open_box); hand-edited values drop the marker instead of reaching tray/PDP labels. Existing malformed-match test extended.

## Round 46 (Muse 1 high + 1 med + 2 low on a2812d1279 — 1 fixed, 3 adjudicated; Codex 2 P1 + 1 P3 — all fixed)

- Muse HIGH native-assurance-gate FIXED (escalation of the Round 45 M1 adjudication — the future-divergence rebuttal is fair): native CONFIG gains ENABLE_SMART_CART_PRO (expo extra enableSmartCartPro, default true preserving the documented Ogabassey default-on) and the cart default is now flag && slug === 'ogabassey', mirroring web's resolveAssuranceDefault. Builds can now opt out without a code change. Both cart-store mocks extended; new test pins gate-off → opt-in (11/11).
- Muse medium intake-spam adjudicated: repeat of the PR-disclosed deferred exposure (rotation, no CAPTCHA, 50/hour budget); erasure/monitoring is a product decision (open questions).
- Muse low assist-cost adjudicated: endpoint is dev-gated unless STOREFRONT_SEARCH_ASSIST_ENABLED; prod enablement + spend ownership is a product decision (open questions).
- Muse low refined-count adjudicated: repeat of the line-187 adjudication (count adjusted = display truth, totalCount raw = paging so stranded rows stay reachable).
- CX-90 (P1) FIXED: native assurance default extracted to stores/cart-assurance-policy.ts (resolveNativeAssuranceDefault, mirroring web's policy module); cart-store drops back under the 300 ceiling with only a call site. Existing assurance tests pin behavior through the store (config mock applies to the policy import).
- CX-91 (P1) FIXED: proxy security stage passes the normalized apiRateLimitPathname into checkRateLimit (new optional override; raw pathname remains the default for direct route callers). Alias-shaped intake/assist paths now receive their endpoint budgets instead of the generic 50/min — verified neither handler self-limits, so the proxy is the only IP gate. Tests pin the wiring (alias → normalized pathname arg) and the bucket behavior (raw → 50, override → 10).
- CX-92 (P3) FIXED: hasActiveSearchRefinements treats minPrice 0 as absent (like the zero rating floor); maxPrice 0 stays active since it excludes every positive price. Tests pin 0 → false, 100 → true. Price chips intentionally unchanged (finding scoped to detection; the chip offers removal of the entered bound).

## Round 47 (Codex 1 P1 + 2 P2 on 5f398de0a0 — all fixed; Muse 2 med + 2 low — all adjudicated)

- CX-93 (P2) FIXED: mobile assistance requests send x-baci-storefront-slug (CONFIG.MERCHANT_SLUG) as the mismatch assertion, so non-Ogabassey builds fail closed (503) instead of silently consuming the configured tenant's budget/branding. Test pins the header.
- CX-94 (P2) FIXED: PDP canonical-slug redirect preserves all route params (variant/offer/base-match identity); the invalid-selection redirect stays bare intentionally (it clears). Test pins legacy slug → canonical + params.
- CX-95 (P1) FIXED: migration 20261008150000 restores the published-or-platform-admin predicate (established form from the option projection/MCP search) in refined candidates + price_options; all public refined RPCs delegate to these two, so the family is covered. Registered (sha bf179aa2…); scratch probe on the real file gives 1/1/0/1 on both functions.
- Muse med intake-rotation: PR-disclosed repeat. Muse med assurance-disclosure: code correct per Muse; fee itemized (Round 42 evidence) + opt-out persistence pinned (native rehydration/merge test, web merge tests) + toggles tested both sides.
- Muse low facet-throw: sole caller catches immediately to empty-facets + facetError; 'keeps results available when filters fail' regression test exists. Muse low intake-PII: informational, by design.

## Round 48 (Muse 3 med + 2 low on b77f7a27d7 — 1 fixed, 4 adjudicated; CI 2 failures fixed; Codex pending)

- Muse MED zero-price-default FIXED: unavailableIds is now required (no [] default) on CompareTable + CompareView; the full chain (compare screen → view → table) already passes explicitly and the zero-price regression test exists. TS now rejects a forgotten prop at compile time.
- Muse med assurance-totals ADJUDICATED with correction: Ogabassey lines defaulted true since before the gate (a2812d1279: `?? slug === 'ogabassey'`); the gate (`&& true`) changed no existing caller behavior. The opt-out contract Muse cites governs merge/undefined semantics (Round 42 verified falsy on all paths), not the add default — and it is preserved.
- Muse med platform-admin-visibility ADJUDICATED: exemption matches 5+ established projections byte-for-byte in predicate form (option projection, MCP search, serialized inventory, PDP snapshots); membership is managed via a dedicated RPC + audited. No new trust assumption vs the established paths CX-95 demanded parity with; column-level RLS hardening is a platform-wide follow-up.
- Muse low intake-oracle + low pagination-total: repeats (public-slug acceptance; line-187 documented contract).
- CI Quality Gate - Test FIXED: redirects test asserted the old string-form canonical replace; updated to the CX-94 object form (8/8). Invalid-selection reset assertion unchanged (still bare).
- CI shard 4 FIXED: inventory snapshot regenerated via sanctioned CLI + pin update (proxy/route sources moved).

## Round 49 (Muse 3 med + 1 low on 59776f8b63 — all adjudicated; Codex 4 P2 — all fixed)

- Muse med intake-rotation: PR-disclosed repeat (CAPTCHA/verified-contact is the documented follow-up).
- Muse med assurance-consent: logic confirmed correct by Muse; residual is device/browser visual verification — already an open product decision (device QA).
- Muse low comparison-key: pre-existing by-design identity (one row per product, documented in-store); re-keying by variant/offer is a feature change out of scope.
- Muse med gates-incomplete: no code defect; cites the stale PR description for old failures — CI on the current head is the live gate being awaited.
- CX-96 (P2) FIXED: migration 20261008160000 mirrors the variants-branch parent-stock fallback into the offers branch (NULL offer qty + stocked parent now surfaces). Scratch probe: stocked→1 row, empty→0. Registered (sha b00e8573…).
- CX-97 (P2) FIXED: brand chips dedupe by trimmed-lowercase identity (first spelling wins) and dismissal removes all equivalents. Existing test updated (it pinned the duplicate behavior).
- CX-98 (P2) FIXED (regression from the M3 constraint): SearchCompareButton persists normalizeCanonicalProductCondition (uk_used→used; total function, ''→undefined) so the schema keeps the marker. Single writer verified. Test pins uk_used→used.
- CX-99 (P2) FIXED: migration 20261008170000 applies published-or-platform-admin to the intake merchant lookup (grants preserved by OR REPLACE). Scratch: pub+admin accepted, unknown/dark rejected. Registered (sha c4822a10…).

## Round 50 (Muse 1 med + 2 low on 05c0a29326 — all adjudicated; Codex pending)

## Round 51 (Muse 1 med on 589879eb51 — verified with evidence; Codex pending)

- Muse med chain-replay VERIFIED: applied 08150000→08160000→08170000 in order on a clean scratch PG with ON_ERROR_STOP — all apply; final pg_get_functiondef of all four functions carries every appended fix. All three are signature-identical CREATE OR REPLACE, inherently order-safe; search-pending registry pins each sha (replay test green).

## Round 52 (Codex 1 P1 + 3 P2 on 589879eb51 — all fixed)

- CX-100 (P2) FIXED: web resolveSelectionPricing offer branch inherits parent stock on null (was ?? 0 → false out-of-stock), mirroring the variants branch + CTE. Test pins null offer qty + parent 10 → stock 10.
- CX-101 (P2) FIXED: web + native refinement fields sync expanded to focusGroup via effect (sheet stays mounted across pills). Rerender tests both sides flip aria-expanded/accessibilityState.
- CX-102 (P1) FIXED: assurance row rethemed to storefront tokens (primary/background-text/border), mirroring the sibling toggle in cart-page-line-item exactly. No class assertions in tests.
- CX-103 (P2) FIXED: migration 20261008180000 excludes same-condition offers via a normalize_condition_for_match helper mirroring the TS normalizer. Probe: cheap same-condition + uk_used-alias offers dropped, different-condition kept, helper mapping exact. Registered (sha 2ed3088c…).
- Follow-up noted: the established native comparison-refresh projection still emits same-condition offers — needs its own review (separate function/consumers, out of this finding's scope).

## Round 53 (Muse 1 med + 2 low on 26fb9be936 — 1 fixed, 2 adjudicated; Codex pending)

- Muse med intake-rotation: PR-disclosed repeat.
- Muse LOW randomUUID FIXED: request ids now use createProductRequestId (randomUUID → getRandomValues v4 → Math.random v4), always emitting server-valid UUIDs. Regression test simulates undefined randomUUID and asserts v4 shape + sent status. The throw-recovery test still passes (throw path unchanged).
- Muse low assist-budget: dev-gated (lines 24-28) + explicit flag; ceiling tightening is a pre-enablement product decision.

## Round 54 (Muse 1 med + 1 low on ad830af0a5 — both adjudicated; Codex pending)

- Muse med assurance-disclosure: repeat (itemization + merge/rehydration evidence on record; row copy quoted by Muse itself).
- Muse low intake-rotation: PR-disclosed repeat.

## Round 55 (Codex 4 P1 + 1 P2 on ad830af0a5 — all fixed)

- CX-104/105/106/107 FIXED together: single shared `resolveAddedLineAssurance` in packages/shared (one export) with the voucher opt-out rule; both per-app policy files deleted (callers updated: 4 web sites + native store/merge). Shared colocated test (14 cases incl. voucher matrix); provider + native voucher tests added (web handoff, native new-line + merge). The merge path needed a policy arg; legacy-undefined preserved.
- CX-108 (P2) FIXED: the 4 canonical PDP redirects (top-level + content, legacy + category/case) preserve the query string via an extended getRedirectTargetPath (arrays appended, undefined dropped); the invalid-variant redirect stays intentionally bare. Category-mismatch test pins variant_id + match_base survival. (Test hygiene: route control consumes only the LCP hint, so the new test queues only that — clearAllMocks does not drain Once queues.)
- CI shard 4: inventory regen + pin (page.tsx moved the tree).

- Muse low intake-oracle: repeat (accepted public-slug signal).
- Muse med intake-rotation: PR-disclosed repeat.
- Muse low assurance-disclosure: repeat — checkout quote itemization + invoice line (Round 42) and the rehydration opt-out test already answer both asks.
- CI Quality Gate - Test FIXED: compare screen test mocked useComparisonProducts without unavailableIds (unfaithful — the hook always returns it); the required prop exposed the mock. Added unavailableIds: [] (6/6). Swept: no other hook mocks.
- CI shard 4 FIXED: inventory regen + pin (Round-49 sources moved the tree).

## Round 56 (CI Misc fail + Muse 2 med + 2 low on 1f640c8b8f — 1 fixed, 4 adjudicated; Codex pending)

- CI Misc FIXED: cart-store.ts hit 308 lines (>300 module-size guard) after Round 55. Extracted nativeAssurancePolicy()/resolveNativeAddedLineAssurance() (CONFIG wiring + voucher sniffing) into stores/cart-assurance-default.ts (29 lines, structural input type so addItem's Omit<CartItem,'id'> fits); store back to 297 lines. Guard green; cart suites 16/16; native lint/typecheck green; edge-inventory pin untouched (web-only snapshot, repo test 1/1).
- Muse med migration-manifest: VALID re description staleness — PR body said "five additive migrations", actual is 23 files + 12 replay tests vs origin/main. Body corrected with the reconciled manifest. Double-apply risk answered: DB Replay is green on this head (4m46s).
- Muse med intake-rotation: PR-disclosed repeat (deferred IP-throttle follow-up; merchant acceptance still needed before public launch).
- Muse low notification-PII: design coherent — contact lives in the merchant-scoped inbox row (needed for fulfillment), reads are merchant-owner-scoped, erase trigger deletes the inbox copy with the request. Retention window is a policy follow-up, not a code defect.
- Muse low pre-add disclosure: verified chain — NEITHER PDP pre-discloses the +5%, but both PDPs route through the cart (web "View Cart and Checkout", native router.navigate('/cart'); no direct checkout), where the fee is itemized with an opt-out toggle before payment. PDP pre-add copy is a product/UX follow-up.

## Round 57 (Codex 1 P1 + 1 P2 on 1f640c8b8f — both addressed)

- CX-109 (P1) ALREADY FIXED: cart-store.ts extraction landed in eb21dfb22e (stores/cart-assurance-default.ts, 297 lines, guard green) before this review arrived. Reply + resolve only.
- CX-110 (P2) FIXED: readValidStoredComparisonItems now dedupes hydrated rows by product id (first row wins) and slices to the newest COMPARISON_TRAY_CAPACITY entries, mirroring the live oldest-first eviction; the add path uses the same constant. New hydration test pins 6 stored rows (1 dup) → 4 newest unique. Provider suites 15/15; web lint/typecheck green; inventory pin untouched (1/1).
- Rebase onto 9de815ba81 (behind-base hook): 6 inventory-refresh commits conflicted, all inventory-only → took new-main side and regenerated once via sanctioned CLI (568 rows, sha 3363cfa2…) + pin. (--source-sha takes the branch head, matching prior rounds.)

## Round 58 (Muse 2 high on fa10389263 — both fixed; Codex pending)

- Muse high voucher-AND (use-cart.tsx + provider) FIXED: all 4 assurance handoff sites used Boolean(quizAwardId && quizVoucherToken), so single-identifier voucher lines defaulted assurance ON on web while native (OR) forced opt-out. Changed to ||. Checkout pricing (build-order-items, sanitizer) intentionally keeps AND — widening the fee opt-out is fail-closed, while zeroing prices on partial ids would be a revenue decision; single-id lines now get no fee but full price (safe on both axes). Regression tests in both assurance suites (both/award-only/token-only → OFF); negative control: the 2 new provider tests fail on the && code. Suites 16/16 + use-cart 10/10; pin 1/1.

## Round 59 (Codex 2 P1 + 3 P2 + 1 low on eb21dfb — all fixed)

- CX-111 (low) FIXED: verify-sql.mjs applied only the pre-restriction intake migration and drove submits as service_role. Now applies 20261004170500, drives intake as storefront_intake, and pins service_role denied. Replay green.
- CX-112 (P1) FIXED: nativeAssurancePolicy moved to stores/cart-assurance-config.ts; cart-assurance-default.ts keeps the single resolveNativeAddedLineAssurance export. Store at 295 lines.
- CX-113 (P1) FIXED: colocated cart-assurance-default.test.ts (config gate + voucher matrix, 8 cases) and cart-assurance-config.test.ts (passthrough, 2 cases). Native cart suites 26/26.
- CX-114 (P2) FIXED: migration 20261008190000 bounds the offers CTE to ORDER BY condition, id LIMIT 16, mirroring the PDP snapshot window (d6272745…). Probe: 16 windowed @100, 17th-row @50 hidden, same-condition/base intact.
- CX-115 (P2) FIXED: migration 20261008200000 adds a 129-capped non-anchor variant count <= 128 to the parent CTE (32fdad8d…), mirroring the snapshot's variants_truncated predicate. Zero options → candidates/facets/compare-refresh all treat the product as unavailable (verified: candidates requires matched IS NOT NULL; compare hook maps empty to unavailable). Probe: 129 → 0 rows, 128 + 50 anchors → 128.
- CX-116 (P2) FIXED: migration 20261008210000 adds normalize_request_contact_key (email → lowercase, else digits) and uses it in 24h dedup + per-contact budget (6b2e3ec6…); stored spelling untouched. Probe: key mapping exact, punctuation-variant dedup, 3-across-spellings then reject, email case retained. verify-sql.mjs extended with the same probes (delivered 5 → 8) and now also applies M3 (needed is_platform_admin stub column).
- All 3 registered in the 3 registries; registry + inventory tests green. PR body manifest updated to 26.

## Round 60 (Codex 3 P1 + 1 P2 on 890ba99 — all fixed; Muse clean)

- CX-117 (P1) FIXED: native cart-stock check selected only stock_quantity, so legacy rows (NULL manage_stock, qty 0, positive stock) rolled back add-to-cart while search/PDP sold them. Now selects stock and applies the same effective-stock fallback. Tests: fallback + precedence (7/7).
- CX-118 (P1) FIXED: redirect query serialization extracted from the category PDP page into category-product-redirect-query.ts (+ 4-case colocated test); page 787 → 778 lines. Page suite still 86/86.
- CX-119 (P2) FIXED: web comparison tray suppresses parent key_specs for variant matches (snapshot-authoritative basis, legacy live fallback), mirroring native; cells render Unknown. Offer/base matches keep specs. Tray test added.
- CX-120 (P1) FIXED: redOutline (Ogabassey brand red) replaced by the per-merchant border-store-primary token; prop removed from form + caller, test rewritten to the themed contract.
- Muse on 890ba99: no highs; 2 lows both adjudicated repeats (AI assist tenant spend is dev-gated; intake rotation PR-disclosed).
- CI inventory regen + pin (page extraction moved the tree).

## Round 61 (Muse 2 med + 2 low on 0729903 — 1 fixed, 3 adjudicated; Codex pending)

- Muse med unbounded family pagination ADJUDICATED (intended design): collectRankedSearchProductIds documents "omit maxCandidates when post-filtered counts must be exact" — the family path returns count: filteredProducts.length for pagination, so capping would silently corrupt page math. The real fix (push the family filter into SQL) touches base search_products_v2 RPC (June infra, not PR-owned) → follow-up outside this PR.
- Muse low RPC error mapping FIXED: migration 20261008220000 gives intake outcomes distinct codes (23505 conflict, P0001 unavailable; 54000/22023 unchanged, messages unchanged); route maps on SQLSTATE only. Route tests refixtured (5/5); verify-sql.mjs applies M4 and pins both codes; scratch probe green. Registered (9e96115c…). PR body → 27.
- Muse low idempotency-canonical ADJUDICATED (intended): same requestId + different payload raising conflict is textbook idempotency (the key binds the payload; retries reuse the identical payload). Cross-spelling repeats are covered by the canonical 24h dedup net, not the id branch.
- Muse med assurance disclosure: repeat (both PDPs route through the itemized cart toggle; pre-add copy is a product follow-up).

## Round 62 (Muse 4 low on f88fa83 — all adjudicated repeats; Codex + CI pending)

- Muse low intake-budget: PR-disclosed repeat (distributed callers vs 50/hr merchant budget; 54000 merchantSlug log signal exists for alerting).
- Muse low idempotency-canonical: repeat of the Round 61 adjudication (key binds payload; canonical dedup is the cross-spelling net).
- Muse low capacity 3v4: repeat of the line-7 adjudication (intentional session-local presentation difference).
- Muse low Origin-absent: repeat — PR's api-security.ts change is a one-line rate-limit call-site; Origin-absent behavior is pre-existing shared infra, and the intake route carries no ambient authority (line-297 CSRF adjudication).

## Round 63 (Codex 1 P1 + 1 P2 on cbeb050 — both fixed)

- CX-121 (P1) FIXED: search-comparison.tsx (301 lines, 2 exports) split — SearchCompareButton → search-compare-button.tsx (101 lines) + colocated test with the 3 moved button tests; tray keeps 206 lines. Consumers + presentation tests re-imported. Suites 15/15 preserved.
- CX-122 (P2) FIXED: normalizeStorefrontProductVariants took no parent context and mapped null variant qty → 0, so inheriting variants showed out-of-stock on the PDP while search sold them (downstream ?? fallbacks in client/pricing were dead). Normalizer now takes required parentStock (getEffectiveStock at all 4 call sites: generic mapper, category resolution, 2 LCP projections) and resolves null → parent. No type changes, no consumer fallout (typecheck clean). Tests: inheritance + explicit-zero unit cases, mapper parentStock wiring test. Normalizer 13/13, PDP suites 98/98 + 17/17 + 6/6.
- Placement note: resolving in the normalizer (vs widening ProductVariant to null) keeps all downstream number contracts intact; quick-view/grid/selection inherit the fix via effective numbers.
- CI inventory regen + pin (comparison split moved the tree).

## Round 64 (Muse 1 high + 1 med + 3 low on a78069b — 2 fixed, 3 adjudicated; Codex pending)

- Muse high stale-gates FIXED (docs): PR body still claimed the six native fixture errors, replay/inventory failures, pending CI, and draft status from implementation. Refreshed to verified truth (all typechecks green locally + CI per head, DB Replay green on recent heads, hooks pass, no gates disabled); kept genuinely-open items (no full-diff CodeRabbit review, device QA pending).
- Muse low deep-imports FIXED: 4 relative shared imports (use-cart 2, provider 2 — one pair mine from Round 55) → '@baci/shared/lib'. Suites 26/26, pin holds.
- Muse low contact-rotation: PR-disclosed repeat.
- Muse low early-adds ADJUDICATED non-issue: storefront mount passes merchantSlug synchronously (shell snapshot route data) so state/ref init with the slug; bare mounts are non-storefront surfaces where opt-in is correct. No pre-hydration divergence on the storefront add path.
- Muse med comparison-namespace ADJUDICATED (pre-existing): v2-comparison-scope.tsx untouched by this PR; current callers pass merchant.id. Required-prop hardening is a follow-up.

## Round 65 (Codex 3 P1 on 8c19ca2 — all fixed; Muse all positive/repeat)

- CX-123 (P1) FIXED: SearchShoppingActions → SearchShoppingActions.tsx (105 lines); Controls keeps the button (114 lines). TopBar + its test re-imported; actions + integration tests moved to the colocated file. Suites 8/8.
- CX-124 (P1) FIXED: added use-product-detail-purchase-state.test.ts — exact offer id and ID-less base-match suppression forwarded into both price calls + offer selection, plus variant skip. 3/3.
- CX-125 (P1) FIXED: product-request.ts split into schema module + product-request-client.ts (error + submit); barrel exports both; consumers untouched. Client tests moved, schema tests added (9/9). Web consumers 10/10; shared/native/web typechecks clean.
- Muse on 8c19ca2: 2 med + 3 low, all positive observations or adjudicated repeats (PII retention policy, disclosure verification, no full-diff CodeRabbit, device QA). No code action.

## Round 66 (Muse 2 med + 2 low on 4b324b2 — 2 fixed, 2 adjudicated; Codex pending)

- Muse med CodeRabbit gate: repeat of the PR-body open item (full-diff review still recommended, not obtained).
- Muse med web-tray identity ADJUDICATED (documented interim design): the tray header states parent-rows-only refresh with verify-on-PDP markers + PDP-as-truth; per-item price-projection verification is a follow-up (new RPCs per tray item + mismatch UX), not a silent defect.
- Muse low idempotency-canonical: documented the exact-resend requirement on submitProductRequest (same id + different payload → 409 by design; equivalent repeats under fresh ids hit canonical dedup).
- Muse low offset clamp FIXED: getRefinedSearchArgs clamps to [0, 1980] (truncated) so native deep links / long tails snap instead of raising 22023 → generic failure. 6 clamp cases; consumers green (web 2/2, native 15/15).

## Round 67 (Codex 2 P1 + 3 P2 on 2fa2bab — all fixed; Muse 2 med + 2 low adjudicated)

- CX-126 (P1) FIXED: comparison-session split on both apps (context + provider + hook modules, hook tests). Web suites 19/19, native 11/11.
- CX-127 (P1) FIXED: checkStock takes variantId and validates option-level effective stock (finite wins, null inherits parent, serialized bypasses, vanished → 0 / other errors throw). Both use-cart call sites pass item.variant_id. Stock suite 11/11. (Cart lines carry no offer id, so offers stay parent-validated — noted.)
- CX-128 (P2) FIXED: migration 20261008230000 folds the 00 dialing prefix into contact keys (8f62f43b…); submit needs no change (dynamic reference). Probe: +/00 fold, domestic/email intact, cross-prefix dedup. verify-sql applies M5 + 00 probe. Registered; PR body → 28.
- CX-129 (P2) FIXED: index card shows Options for exact variant matches (searchMatch.variantId in predicate). 2 label cases (14/14).
- CX-130 (P2) FIXED: brand search input stays while its query is nonempty (brands ≤ 6 shrink case). Regression test (8/8).
- Muse: med rotation + med tray identity repeats; low idempotency satisfied via the Round 66 doc; low inbox-XSS adjudicated (React-default escaping, pre-existing files, no unescaped sinks).
- CI inventory regen + pin (session split moved the tree).

## Round 68 (Muse 2 med + 1 low on 10f6a2f — all adjudicated, 0 code action; Codex pending)

- Muse med Assurance default-on ADJUDICATED (product sign-off, already tracked): policy + opt-out preservation + cart disclosure verified in code; Muse itself frames remaining risk as product/UX, not logic. Needs explicit merchant approval before merge — open product decision, unchanged.
- Muse med deploy-ordering ADJUDICATED non-issue: both the base intake migration (20261002190000, raises 22023) and the outcome-code migration (20261008220000, P0001) ship in this PR and apply in timestamp order in one migration run before web deploys — the route's P0001 contract always meets the migrated head. No deploy window.
- Muse low platform-admin visibility ADJUDICATED (parity confirmed): pre-existing public projections (20261001140000 MCP search, 20261002090720 variant projection, 20261002090724 bounded search, 20261002090725/31/32 bounds) all use the published-or-platform-admin form. Header claim verified; no unpublished-store leak beyond established behavior.

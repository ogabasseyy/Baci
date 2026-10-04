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

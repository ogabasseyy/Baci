# Repairs Catalog — Supabase Branch-Apply & Go-Live Runbook

This feature ships **16 append-only July catalog migrations**, then a **paid GIGL
pickup follow-on** set (36 September migrations, including security hardenings).
Operators must apply both catalogs in order. SQL verification scripts live under
`supabase/migrations/tests/` for the paid-pickup path and under `supabase/tests/`
for the original July catalog. Follow this order exactly, verify each gate, then
flip the flag.

## 1. Apply migrations (strict order — later ones depend on earlier)

| # | Migration | Purpose | Depends on |
|---|-----------|---------|-----------|
| 1 | `20260711100001_repairs_catalog_feature_flag.sql` | `merchant_feature_settings.repairs_catalog_enabled` (bool, default false) + private `repair_settings` jsonb | — |
| 2 | `20260711100002_repair_catalog_tables.sql` | `repair_service_types`, `repair_devices`, `repair_quotes`; composite tenant FKs; `repairs_catalog_publicly_enabled()` helper; column-scoped anon+authenticated grants (excludes `internal_notes`) | 1 (helper reads the flag) |
| 3 | `20260711100003_repairs_booking_catalog_link.sql` | adds `device_id/quote_id/quoted_price/repair_type_label/shipment_id` to `repairs`; status-lookup index | 2 |
| 4 | `20260711100004_create_repair_booking_rpc.sql` | `private.create_repair_booking` (SECURITY DEFINER) + `public.create_repair_booking` (INVOKER wrapper); DB-side rate caps; server-side price snapshot | 2, 3 |
| 5 | `20260711100005_repairs_anon_hardening.sql` | REVOKE anon on `repairs` + ticket seq; drop the old public INSERT policy (writes now only via the RPC) | 4 (**must come after** the RPC or booking breaks) |
| 6 | `20260711100006_repairs_role_permissions.sql` | seeds `repairs` resource (view/edit/delete) into `role_permissions`; switches `repairs` table policies to `check_staff_permission` | 2 |
| 7 | `20260711100007_repair_pickup_quotes.sql` | private `repair_pickup_quotes` (merchant-only RLS, **no anon**); **`shipments.order_id` → nullable** | 3 |
| 8 | `20260711100008_repair_status_lookup_rpc.sql` | `get_repair_status()` enumeration-safe public lookup | 3, 7 |
| 9 | `20260711100009_repairs_rpc_hardening.sql` | CREATE OR REPLACE of the booking RPC: normalizes the per-email rate-cap count (whitespace-variant bypass) + pins the public wrapper's `search_path` | 4 |
| 10 | `20260711100010_add_repairs_catalog_enabled_to_cached_merchant_rpc.sql` | CREATE OR REPLACE of `resolve_storefront_cached_merchant`: adds the `'repairs_catalog_enabled'` pair to the public `feature_settings` jsonb so the storefront merchant-shell path (`getCachedMerchant`/`getCachedMerchantByDomain`) surfaces the flag; re-asserts the service-role-only grant | 1 (the column) **and** main's `20260707211507` (the base RPC it replaces — this migration must apply after `main` is merged) |
| 11 | `20260711100011_require_published_store_in_repairs_gate.sql` | CREATE OR REPLACE `repairs_catalog_publicly_enabled` to also require `m.is_published` — draft (unpublished) stores' repair catalogue was anon-readable pre-publish (Codex P2) | 2 |
| 12 | `20260711100012_throttle_repair_status_rpc.sql` | CREATE OR REPLACE `get_repair_status` (sql STABLE → plpgsql): DB-side 60/hr cap per (merchant, email) via existing `check_rate_limit`/`rate_limit_log`, closing the direct-`/rest/v1/rpc` ticket-sweep bypass of the route limiter; throttled calls return empty (identical to not-found); fail-open if the limiter errors (Codex P2, twice-flagged — supersedes the earlier §7 accept-as-is note) | 8 |
| 13 | `20260711100013_repair_booking_rpc_input_validation.sql` | CREATE OR REPLACE `private.create_repair_booking`: the SECURITY DEFINER fn validates + normalizes customer/device fields itself (anon can call the wrapper directly via REST, bypassing the app-layer Zod), rejecting malformed input | 4, 9 |
| 14 | `20260711100014_repair_pickup_claim_and_shipment_scope.sql` | adds `repairs.pickup_booking_lock_token`/`pickup_booking_started_at` (+ partial index) to serialize provider-backed pickup booking (no duplicate charges); keeps repair `shipments` tenant-scoped | 3, 7 |
| 15 | `20260711100015_repair_catalog_review_hardening.sql` | round-6 hardening: `UNIQUE (id, merchant_id)` on `repairs`; tenant-scope `repair_pickup_quotes.repair_id` by merchant; public quote RLS depends on active parent device/service rows; snapshot catalogue device details from the resolved quote/device row | 2, 3, 7 |
| 16 | `20260711100016_public_feed_merchant_logo_url.sql` | DROP/CREATE `resolve_public_feed_merchant`: adds `logo_url` to the public feed resolver so service feeds share the agent-JSONL repairs-feed image fallback | baseline `resolve_public_feed_merchant` only (no other repairs migration) |

Use `mcp__supabase__apply_migration` (or the branch's SQL editor) file-by-file in this order.
**Supabase branches fail baseline replay** — if the branch can't replay the full baseline,
hand-build the prod-like precondition state first (the `merchants`, `merchant_feature_settings`,
`role_permissions`, `shipments`, `products`, `product_key_specs` tables must exist).

### 1b. Paid GIGL pickup follow-on (apply after the July catalog)

Customer-funded GIGL doorstep pickup needs these September migrations in order.
Do **not** skip them when enabling paid pickup on a branch that already has the
July catalog:

1. `20260901220400_atomic_rejected_repair_pickup_release.sql` — atomic release of rejected pickup reservations
2. `20260902054000_paid_repair_pickup_fulfillment.sql` — paid pickup payment + fulfillment columns/RPCs
3. `20260902054100_index_repair_pickup_transactions.sql` — indexes for pickup payment transactions
4. `20260903080000_repair_pickup_receiver_projection.sql` — repair-center destination projection RPC
5. `20260903090000_repair_pickup_terminal_payment_capture.sql` — terminal payment capture hardening
6. `20260903095000_repair_pickup_receiver_server_only.sql` — revoke storefront-facing receiver access
7. `20260903101000_repair_pickup_receiver_storefront_grants.sql` — role/grant scaffolding for the receiver capability
8. `20260903101500_secure_repair_pickup_receiver_capability.sql` — JWT merchant-bound capability gate for `get_repair_pickup_receiver`
9. `20260903120000_exclude_repair_pickup_from_merchant_sales.sql` — exclude pickup fee captures from merchant sales totals
10. `20260903130000_validate_repair_pickup_receiver_phone.sql` — require a usable repair-center phone on the projection
11. `20260904090000_find_resumable_repair_pickup.sql` — unpaid pickup reclaim RPC (initial)
12. `20260904110000_secure_find_resumable_repair_pickup.sql` — lock reclaim behind the same receiver capability; exclude terminal statuses
13. `20260904110100_exclude_repair_pickup_refunds_from_reconciliation.sql` — exclude pickup refunds from admin reconciliation metrics/lanes
14. `20260904120000_record_repair_pickup_payment_mismatch.sql` — ledger claim mismatches and force review without booking
15. `20260904130000_awaiting_repair_pickup_payment.sql` — allow `awaiting_payment` status + capability-gated mark RPC so unpaid new pickups are not bookable
16. `20260904140000_find_resumable_repair_pickup_by_id.sql` — optional `p_repair_id` so resume reclaim pins the claim ticket (not a newer unpaid sibling)
17. `20260904150000_create_repair_booking_awaiting_pickup_payment.sql` — pickup creates insert `awaiting_payment` atomically so a failed post-create mark cannot leave a bookable null/null row
18. `20260904160000_normalize_nigerian_repair_pickup_receiver_phone.sql` — accept Nigerian local `0XXXXXXXXXX` phones in the usable-phone gate (app schema already accepts them)
19. `20260904170000_find_resumable_repair_pickup_return_details.sql` — return device/phone/address so resume reclaim can bind to saved pickup details
20. `20260904180000_claim_repair_pickup_booking_terminal_guard.sql` — refuse claims on completed/cancelled/rejected repairs and return `terminal=true`
21. `20260904190000_bind_repair_pickup_pending_payment_reference.sql` — pending Paystack `RPU-…` binding column + capability-gated bind RPC (before initializeTransaction)
22. `20260904190050_clear_repair_pickup_pending_payment_reference.sql` — clear pending binding on confirm and mismatch ledger
23. `20260904190100_activate_gigl_monitor_for_repair_pickups.sql` — enroll repair-linked orderless GIGL shipments in automated tracking monitors
24. `20260904190200_apply_gigl_tracking_orderless_repair_pickups.sql` — null-safe apply RPC + nullable notification outbox for orderless repair pickups
25. `20260904190300_manual_fulfilled_repair_pickup_payment_status.sql` — distinct `manual_fulfilled` status so merchant offline arrangement is non-bookable (unlike payment-side `review`)
26. `20260904190400_repair_pickup_pending_payment_references.sql` — history table preserving every pending RPU tip across payment retries
27. `20260904190450_consume_repair_pickup_pending_payment_references.sql` — consume history rows on confirm/mismatch; clear tip only when it matches the settled reference
28. `20260904190500_preserve_manual_fulfilled_on_late_pickup_capture.sql` — late Paystack capture after merchant manual fulfillment (or booked) ledgers money without overwriting those terminal statuses to paid
29. `20260904190550_fix_gigl_tracking_notification_conflict_target.sql` — rebind orderless apply RPC ON CONFLICT to bare exclusion so partial milestone/attempt indexes race safely
30. `20260904190600_defer_repair_pickup_pending_consume_until_fulfilled.sql` — keep pending RPU history until booked/manual_fulfilled so Paystack redelivery can bind after secret-key rotation while GIGL booking is still retrying
31. `20260904190650_claim_gigl_tracking_notifications_repair_id.sql` — project `repair_id` on GIGL notification claims for orderless pickups (no privileged `repairs` table read in the worker)
32. `20260904190700_claim_repair_pickup_booking_manual_fulfilled_guard.sql` — refuse claims when `pickup_payment_status = manual_fulfilled` and return `terminal=true` (merchant offline fulfillment race)
33. `20260905140000_restore_gigl_repair_pickup_tracking_hardening.sql` — restore failed-event recovery, delivered_at, and manual-failed terminality without recreating the orderless apply RPC
34. `20260905140100_retire_orderless_gigl_monitors_without_repair.sql` — retire orderless GIGL monitors when the linked repair is deleted
35. `20260905140200_fulfill_paid_repair_pickup_receiver.sql` — paid-fulfillment JWT still projects unpublished or pickup-disabled repair centers
36. `20260905140300_gigl_monitor_fast_path_merchant_identity.sql` — include merchant ownership on the orderless monitor fast path

## 2. Run the SQL verification scripts (after all 16 July migrations apply)

Run each against the branch (`psql -f` or SQL editor); every assertion must pass:

- `supabase/tests/repair_catalog_rls.sql` — RLS enabled; public policies gate on `is_active` + helper; column grants exclude `repair_quotes.internal_notes` for **both** anon and authenticated; helper normalizes `electronics`+`gadgets`.
- `supabase/tests/repair_booking_rpc.sql` — wrapper INVOKER + anon/authenticated EXECUTE; private fn DEFINER + empty search_path; anon has **no** direct DML on `repairs`; old public INSERT policy gone.
- `supabase/tests/repairs_role_permissions.sql` — per-role seed present (admin full, accountant read-only, blog_manager none); baseline owner-only policies dropped; staff policies use the helper.
- `supabase/tests/repair_pickup_quotes_rls.sql` — merchant-only RLS; no anon grants; `shipments.order_id` is nullable.

### 2b. Paid GIGL pickup verification (after §1b)

Run these after the September paid-pickup migrations:

- `supabase/migrations/tests/repair_pickup_payment_confirmation.sql` — paid pickup confirmation / fulfillment invariants
- `supabase/migrations/tests/repair_pickup_receiver_projection.sql` — receiver projection is capability-gated and phone-complete
- `supabase/migrations/tests/find_resumable_repair_pickup.sql` — resumable unpaid pickup reclaim requires matching JWT claims; `p_repair_id` pins the claim ticket; anon/authenticated cannot execute
- `supabase/migrations/tests/normalize_nigerian_repair_pickup_receiver_phone.sql` — local trunk phones like `09070007000` normalize and pass the usable-phone gate
- `supabase/migrations/tests/claim_repair_pickup_booking_terminal.sql` — claim RPC refuses terminal repairs and reports `terminal=true`
- `supabase/migrations/tests/claim_repair_pickup_booking_manual_fulfilled.sql` — claim RPC refuses `manual_fulfilled` (non-terminal repair status) and reports `terminal=true`
- `supabase/migrations/tests/repair_pickup_receiver_fulfillment.sql` — fulfillment JWT still projects unpublished or pickup-disabled receivers; quote JWT does not
- `supabase/migrations/tests/gigl_tracking_orderless_repair_unlink.sql` — deleting the linked repair retires the orderless GIGL monitor

### Manual smoke checks (do these on the branch too)
- **Anon REST, flag OFF merchant:** `repair_devices`/`repair_quotes` return **zero rows** (feature gate lives in the RLS policy, not just app code).
- **Anon REST, `internal_notes`:** selecting it errors / is absent for both anon and authenticated.
- **Booking RPC:** call `public.create_repair_booking(...)` with the anon key — succeeds for a valid merchant; rejects an inactive/foreign `quote_id` (`quote_unavailable`); flood → `rate_limited`; the returned row's `quoted_price` equals the quote's price regardless of any client-supplied value.
- **Status RPC:** `get_repair_status(merchant, ticket, wrong_email)` returns 0 rows; correct triple returns 1.
- **`shipments.order_id` nullable:** existing rows unaffected (FK already permitted NULL); an insert with NULL `order_id` succeeds.
- **Cached-merchant RPC surfaces the flag (migration `20260711100010`):** `SELECT (feature_settings ? 'repairs_catalog_enabled') FROM public.resolve_storefront_cached_merchant('<ogabassey-slug>');` returns `true` (there is no `supabase/tests/*.sql` for `resolve_storefront_cached_merchant`, so verify this manually). With the flag on, the value should be `true`; the storefront merchant shell reads it from this jsonb.

## 3. Regenerate types
`apps/web/src/types/supabase.ts` must include the Sept pickup-payment columns, pending-reference
table, and public RPCs before merge. Prefer a clean history-replay `--types-output` regen after
prod apply; until then keep the checked-in patch in sync with the migration chain.

## 4. Merge the branch to prod, then deploy the app branch
Standard flow. After the DB migrations are on prod, deploy `codex/repairs-catalog`.

## 5. Enable for OgaBassey (the pilot merchant)
1. `UPDATE merchant_feature_settings SET repairs_catalog_enabled = true WHERE merchant_id = <ogabassey>;`
   (verify OgaBassey's `business_type` is `electronics`/`gadgets` first — the RLS helper requires it).
2. Populate the private repair-center address so pickup quoting works, via the **dashboard → Repairs → Settings** card (writes `merchant_feature_settings.repair_settings`). Until set, the storefront shows drop-off-only with a "merchant will arrange pickup" message — no breakage.
3. Seed the catalogue: dashboard → Repairs → Catalog → **AI Import**, paste the WhatsApp price list → review → commit. (Or add devices/quotes manually.)

## 6. Post-go-live validation
- Storefront: `ogabassey.com/repairs` shows the device picker; a device page lists quotes; booking returns a ticket # and fires the merchant push + customer email.
- Dashboard: the booking appears; status advance / estimated_cost / admin_notes work; "Request courier pickup" either books GIGL doorstep collection or offers the manual fallback.
- Customer status page `/repair/status`: ticket + email returns status; wrong email returns "not found".
- Mobile: storefront repairs screen shows the catalogue (falls back to WhatsApp only if flag off); mobile-admin shows the booking and the push deep-link opens it.

## 7. Reviewed decisions (researched against repo precedent — no change, deliberately)
- **`get_repair_status` — decision REVISED (superseded by migration 12).** Original call: keep anon-`EXECUTE` with no DB throttle, matching the `get_order_tracking` precedent. After Codex flagged the direct-`/rest/v1/rpc` bypass a second time, the decision was revisited: the deciding difference from the precedent is that `ticket_number` is a **small sequential integer** (genuinely sweepable with a known email), unlike order tracking's uuid/opaque-token lookups. Migration `20260711100012` therefore adds a DB-side 60/hr cap per (merchant, normalized email) inside the RPC via the existing `check_rate_limit` infra — throttled calls return empty (identical to not-found, preserving the enumeration-safe shape), fail-open if the limiter errors. anon `EXECUTE` stays (no service-role rule violation); the route's 10/min limiter remains the first line.
- **repairs indexes stay plain `CREATE INDEX` (matches repo default).** `CREATE INDEX` (not `CONCURRENTLY`) briefly locks writes on `public.repairs` during apply. Decision: **keep as-is.** The repo reserves `CREATE INDEX CONCURRENTLY` (with a `-- disable-transaction` directive) for hot tables only — `products`, `analytics_events` — against ~353 plain `CREATE INDEX` statements elsewhere; `repairs` is a modest-volume bookings table outside that class, so the one-time lock is sub-second. If `repairs` is unexpectedly large on the target, apply migration `20260711100003` during a low-traffic window.

## 8. Known follow-ups / external actions (NOT code)
- **Meta feed policy:** services-as-products in Meta Commerce Manager is policy-gray. Ingest `/feeds/facebook-repairs.xml` into a **Meta test catalog** and confirm acceptance **before** pointing the live Facebook repairs page at it.
- **GIGL pickup** needs a **funded GIGL account** and a supported doorstep route — do a staging dry-run; when GIGL only offers service-centre delivery, prompt for customer drop-off or use the manual fallback.
- **Branded fallback image (optional):** feed items with no linked-product image, no `repair_devices.image_url`, and no merchant `logo_url` are omitted from the FB feed. Provide a branded repair-service placeholder asset if full coverage is wanted, or ensure devices have images / linked products.
- **`shipping_quotes` PII exposure — already fixed upstream.** The baseline `shipping_quotes` public SELECT `USING (true)` over `quote_request` PII is resolved by migration `20260707015215_scope_shipping_quotes_to_merchant.sql` (merged from `main`): it revokes anon on the table, adds `merchant_id`-scoped `has_merchant_access()` policies, and routes the one guest-reachable read through the SECURITY-DEFINER RPC `get_checkout_shipping_quote` (strips `sender`, omits `provider_metadata`). Repairs uses its own private `repair_pickup_quotes` table regardless. **Action:** just confirm `20260707015215` is applied to the target DB (it ships via `main`'s normal migration flow, not this feature's set).

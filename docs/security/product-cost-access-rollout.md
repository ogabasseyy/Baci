# Product cost access rollout

## Status and scope

This is a compatibility release followed by a separately approved access cutover.
The compatibility migrations alone do **not** close direct shopper access to
`products.cost_price`. Do not describe the incident as resolved until the cutover
and production checks succeed.

This work extends PR #4158 without editing its append-only migration. It replaces
its reversible negotiation floor, adds a protected product read view, and migrates
web/mobile-admin cost readers. The earlier anon-only revoke branch is superseded
by the cutover for both `anon` and `authenticated`.

- `merchant_products` is a read-only, security-barrier, owner-rights view. Its
  explicit caller-bound predicate permits the merchant owner and active staff
  with `products:view`. It is not a public storefront catalog.
- Product writes remain on `products` under existing write RLS. Cost-bearing
  mutation responses use an id-only return followed by an authorized view read.
- The negotiation RPC returns only fixed public-price tiers: rounded-up 98%,
  98.5%, 99%, or the list price. It never returns `cost * 1.1`. Discount eligibility
  still reveals a coarse cost interval; this is not zero-information pricing.
- The existing behavior allowing a customer to buy at list price is preserved,
  even if the recorded cost exceeds that price. No above-list private-cost quote
  is returned.
- Public storefront/mobile-storefront safe-column reads remain on `products`.
  Variant costs retain their existing owner/permissioned-staff RLS boundary.

## Required order

1. Review and merge the additive compatibility code with PR #4158, including
   `20261110150000_merchant_product_cost_access.sql` and
   `20261110150100_quantize_negotiation_cost_floor.sql` and
   `20261110150130_remove_product_cost_row_reads.sql`. The last migration narrows
   whole-row product reads in the invoker inventory trigger/cart helpers without
   increasing their rights. Apply those migrations
   **before** releasing the changed clients. Without the view, merchant cost
   reads fail. A stale, continuous floor causes negotiation to fail closed.
2. Deploy the web release through the approved production flow. Ship the
   mobile-admin release and verify it on owner and authorized-staff accounts.
   Check product lists/details, product/stock/status writes, variant saves,
   reorder suggestions, analytics, transaction review and embedded product reads.
3. Resolve old mobile-admin compatibility explicitly. There is no implemented
   enforced minimum-version gate. Background OTA does not prove installation:
   release bundles download at launch and apply after restart; checked-in native
   projects disable OTA until release prebuild. Choose a verified minimum-version
   rollout or explicitly accept that old clients will fail product-cost queries.
   This change does not add a gate or silently force an update.
4. Obtain explicit production approval for the column-grant change and its old
   client impact. Only then merge/apply the separately staged migration
   `20261110150200_restrict_shopper_product_costs.sql` through the normal migration
   and ledger process. Do not merge this activation draft with the compatibility
   release. The operation remains a transaction-safe rehearsal/emergency entry
   point, not a substitute for recording applied schema history.
5. Run the cutover only after those gates. The operation requires the operator
   acknowledgement setting below and rolls back if inherited grants still expose
   cost. It revokes table-level SELECT **and** explicit cost-column SELECT from
   `PUBLIC`, `anon` and `authenticated`, then grants the current non-cost columns
   to `anon` and `authenticated`. Existing RLS still governs those rows.
6. Reload PostgREST schema and run the post-cutover checks below. Record the exact
   application/native versions, migration version, approver and test evidence.

For an approved operation rehearsal, use a disposable database, then:

```sql
SET baci.product_cost_access_cutover = 'web-and-mobile-admin-verified';
```

Run `supabase/operations/revoke-products-cost-price.sql` using psql with
`ON_ERROR_STOP`. The acknowledgement is an operator release check, not an
application authorization mechanism. Never test on production fixtures.

## Post-cutover checks

- Anonymous visitor and logged-in shopper cannot select `cost_price`, `*`, a
  whole-row representation, or filter/order by cost on `products`.
- Safe product id/name/price selects work in both roles. Product/category/cart,
  checkout and negotiation flows still work in web and mobile storefronts.
- Shopper direct `merchant_products` returns no rows, including known merchant
  ids; an embedded `products:merchant_products(...)` returns no private product.
- Merchant owner and active permitted staff can read their own product costs,
  including draft/archived products; other merchants, denied and suspended staff
  cannot. Suspending staff takes effect without refreshing their JWT.
- Writes through the view fail. Authorized product writes through the base table
  and the subsequent protected read work.
- Direct base-table cost reads also fail for owners, intentionally. The protected
  view is the supported read path.
- No table-level SELECT or cost-column grant remains for PUBLIC/anon/authenticated.
  Check `has_column_privilege` for both client roles to catch inherited grants.

The activation migration updates
`supabase/tests/products_cost_price_anon_containment.sql` to reject both shopper
roles and adds `product_cost_cutover_grants.sql` as a permanent grant guard.
Keep the role regression suite active after activation.
Future product columns need deliberate public SELECT grants and, when needed,
an explicit view refresh. Never restore blanket table SELECT to fix a missing
column or an outdated client.

## Rollback and remaining boundaries

Prefer repairing the protected read path or rolling clients forward. Restoring
blanket SELECT reopens the exposure and requires a separate security decision;
there is no automatic permission rollback. The additive migrations preserve all
cost data and the existing write model.

Existing merchant-scoped RPCs for inventory/monthly-profit aggregates and the
mobile product-save RPC use merchant membership rather than `products:view`.
They reject unrelated shoppers but are broader than the new direct-read view.
This patch does not redefine all staff permissions. Review these separately if
cost access must be denied to every staff member without `products:view`:

- `get_merchant_inventory_stats(uuid)`
- `get_monthly_sales_stats(uuid)`
- `save_mobile_admin_product_with_variants(uuid, uuid, jsonb, jsonb, text)`

Order, supplier and variant costs have separate existing permission contracts;
this work is not a blanket audit or migration of all cost-bearing tables.

## Verification evidence

- 108 focused web consumer tests and 177 mobile-admin consumer tests passed.
- 25 negotiation tests passed, including four new regression failures reproduced
  before the route fix. The old RPC fails the SQL fixed-tier regression.
- 54 replay-registry/manifest tests passed.
- The access and negotiation SQL suites passed in an isolated local PostgreSQL fixture using the
  real staff permission helpers and new migration files.
- Actual PostgREST 16.4 inferred the view's embedded product FK relationship:
  owner embed returned the cost, shopper embed returned null, direct base cost
  reads returned 403, and safe public-column reads returned 200 after cutover.
- The inventory-trigger regression failed before the repair and passed after it
  under real authenticated column restrictions. All five repaired routines retain
  invoker rights; shopper cart catalog helper checks passed too.
- Final split-write regressions passed: 55 web route tests and 32 mobile tests.
  An independent review identified the partial-success/cache invalidation issue;
  its remedy was re-reviewed without new findings.
- Required pre-push monorepo typechecking passed all seven tasks, including the
  full web/native checks, with hooks enabled. An initially missing workspace
  dependency was linked in the task-local test environment; the shared install
  was not changed.
- CodeRabbit reviewed the full 45-file combined stack and raised one minor issue:
  missing mobile preflight rows used `single()` rather than `maybeSingle()`. Both
  preflights were corrected; the 19-test regression suite and Biome passed. The
  correction-only re-review is blocked by the shared CLI rate limit and can be
  retried after its reported ten-minute reset.
- Full historical replay is blocked locally by Supabase CLI version mismatch
  (the repository requires 2.111.0). A manually dispatched full CI run is checking
  the stacked draft because automatic quality gates only target main.
- Full historical replay, monorepo CI and final review remain release gates.
  Focused checks are not a green CI result.

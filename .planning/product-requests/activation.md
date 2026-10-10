# Product request activation

## Implemented locally

- Empty native search header: back arrow and cart icon with count badge.
- Comparison appears only with results and two explicitly selected products.
  Selections remain within the current session and reset across app sessions.
- App and web zero-match states offer Request this product.
- Customer explicitly submits the product name and an email or phone number.
- The normal Supabase client calls a narrowly scoped public intake RPC.
- RLS permits request reads only by the merchant owner. Customers cannot read
  submitted contacts or directly write requests/notifications.
- Requests deduplicate repeated IDs and the same product/contact within 24 hours.
  Intake is bounded to three requests per contact per merchant per hour and fifty
  total per merchant per hour. Merchant scope must identify a published store.
- A private database worker delivers inbox notifications and marks requests
  delivered in the same transaction. Replaying the worker does not duplicate them.
- The existing platform notification audit boundary is preserved: customer calls
  enqueue a request and cannot create platform notifications themselves.

## Database activation

`supabase/migrations/20261002190000_storefront_product_requests.sql` was applied
to the confirmed app project aivqthbxdshhltbwipbr on 2026-10-02. Storage and
RPC intake are active. The active pg_cron job delivers merchant inbox
notifications every minute. No web deployment or native release was performed.

This creates in-app merchant inbox notifications, not verified OS push delivery.
No push-token or service-role notification client is introduced.

## Verification

The migration ran in isolated PGlite with representative tables, role grants,
RLS and an audit trigger. Tested validation, idempotency, duplicate suppression,
contact rate limiting, published-store validation, private reads, worker-only
execution, authenticated customer intake, recipient isolation and worker replay.
The local cron scheduler was stubbed. Live schema inspection found the required
notification scheduled_for constraint; the worker and regression fixture now
include that field. A live guest intake and worker delivery test passed in a
rolled-back transaction, with zero test rows left. RLS and worker execution
permissions were verified, and the scheduled job is active. The first real scheduled execution succeeded (cron.job_run_details). The Data
API also resolves the RPC and rejects invalid input with SQLSTATE 22023.

Reproduce that isolated check with `node .planning/product-requests/verify-sql.mjs`.
Set `PGLITE_MODULE` to the installed PGlite module path if the default
temporary package directory is unavailable.

## Review and broader checks

CodeRabbit completed with one major and two minor findings. The branding minor
was fixed: only Ogabassey receives the explicitly requested red search outline.
The proposed major conditional price lookup is not adopted: unfiltered cards
also need the correct variant/offer price and option identifiers; skipping it
changes that contract. Performance measurement and a preserving optimization
belong to a separate append-only migration, not an edit to the applied migration.
The minor IP edge throttle remains deferred: public direct RPC needs a trusted
network gate rather than spoofable client headers. Contact and merchant database
limits bound intake, but do not identify callers rotating contact information.

Focused request, header, comparison and form tests pass. Web typecheck passed.
The broad monorepo run is not green: existing mobile CTA fixture type errors and
web source-authority/inventory test failures remain; its full completion is not
claimed. Unrelated concurrent dependency edits were preserved.

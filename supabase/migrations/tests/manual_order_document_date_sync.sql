-- =============================================
-- REGRESSION TEST: manual order document date sync
--   Verifies the explicit-date contract end to end on the replayed schema:
--   order_items triggers preserve explicit device-local picker dates, and
--   transaction review moves both document dates to the reviewer's selected
--   calendar day atomically (client timezone, not merchant timezone).
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/tests/manual_order_document_date_sync.sql
-- =============================================

BEGIN;

DO $$
DECLARE
  v_run_id text := txid_current()::text;
  v_merchant_id uuid := gen_random_uuid();
  v_customer_id uuid := gen_random_uuid();
  -- Fixed id so the post-replay block below can re-assert this row.
  v_manual_order_id uuid := 'c0000000-0000-0000-0000-000000000001';
  v_legacy_order_id uuid := gen_random_uuid();
  v_explicit_order_id uuid := gen_random_uuid();
  v_item_id uuid := gen_random_uuid();
  v_legacy_item_id uuid := gen_random_uuid();
  v_explicit_item_id uuid := gen_random_uuid();
  v_issue date;
  v_tax date;
  v_issue_gen boolean;
  v_tax_gen boolean;
  v_txn timestamptz;
BEGIN
  -- Replay checks run as the database owner, but several order triggers
  -- still require a request identity. Mirror the quiz fixture claims.
  PERFORM set_config(
    'request.jwt.claim.sub',
    v_customer_id::text,
    true
  );
  PERFORM set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object(
      'sub', v_customer_id::text,
      'storefront_order_context', 'route',
      'storefront_order_merchant_id', v_merchant_id::text
    )::text,
    true
  );

  INSERT INTO public.merchants (id, email, business_name, slug, country)
  VALUES (
    v_merchant_id,
    format('manual-date-sync-test-%s@example.com', v_run_id),
    'Manual Date Sync Test',
    format('manual-date-sync-test-%s', v_run_id),
    'NG'
  );

  INSERT INTO public.customers (id, merchant_id, email, full_name)
  VALUES (
    v_customer_id,
    v_merchant_id,
    format('manual-date-sync-customer-%s@example.com', v_run_id),
    'Manual Date Sync Customer'
  );

  -- Manual order exactly as the app writes it: the Auckland device picked
  -- Mar 5 00:30 local (2026-03-04T11:30:00Z instant) and the picker day is
  -- stored with explicit (FALSE) provenance.
  INSERT INTO public.orders (
    id,
    merchant_id,
    order_number,
    customer_name,
    customer_email,
    total,
    subtotal,
    payment_status,
    shipping_status,
    source,
    transaction_date,
    invoice_issue_date,
    tax_point_date,
    invoice_issue_date_generated,
    tax_point_date_generated
  ) VALUES (
    v_manual_order_id,
    v_merchant_id,
    format('MANUAL-DATE-SYNC-%s', v_run_id),
    'Manual Date Sync Customer',
    format('manual-date-sync-customer-%s@example.com', v_run_id),
    150000,
    150000,
    'paid',
    'pending',
    'physical',
    '2026-03-04T11:30:00Z',
    '2026-03-05',
    '2026-03-05',
    false,
    false
  );

  -- Legacy generated order: TRUE flags with merchant-timezone dates.
  INSERT INTO public.orders (
    id,
    merchant_id,
    order_number,
    customer_name,
    customer_email,
    total,
    subtotal,
    payment_status,
    shipping_status,
    source,
    transaction_date,
    invoice_issue_date,
    tax_point_date,
    invoice_issue_date_generated,
    tax_point_date_generated
  ) VALUES (
    v_legacy_order_id,
    v_merchant_id,
    format('LEGACY-DATE-SYNC-%s', v_run_id),
    'Manual Date Sync Customer',
    format('manual-date-sync-customer-%s@example.com', v_run_id),
    95000,
    95000,
    'paid',
    'pending',
    'physical',
    '2026-03-04T23:30:00Z',
    '2026-03-05',
    '2026-03-05',
    true,
    true
  );

  -- 1. Item inserts must preserve the explicit device-local day. A Lagos
  -- recompute of the instant would yield Mar 4.
  INSERT INTO public.order_items (id, order_id, name, quantity, price)
  VALUES (v_item_id, v_manual_order_id, 'Manual Fixture Phone', 1, 150000);

  SELECT invoice_issue_date, tax_point_date
  INTO v_issue, v_tax
  FROM public.orders
  WHERE id = v_manual_order_id;
  IF v_issue <> '2026-03-05' OR v_tax <> '2026-03-05' THEN
    RAISE EXCEPTION 'order_items trigger overwrote explicit manual dates: % / %', v_issue, v_tax;
  END IF;

  -- 2. A review date correction moves both dates to the reviewer's selected
  -- day. 2026-06-10T12:30:00Z is Jun 11 in Auckland but Jun 10 in Lagos, so
  -- Jun 11 proves client-timezone (not merchant-timezone) derivation.
  PERFORM public.update_transaction_review_details(
    p_merchant_id := v_merchant_id,
    p_order_id := v_manual_order_id,
    p_order_item_id := v_item_id,
    p_product_id := NULL,
    p_variant_id := NULL,
    p_cost_price := 120000,
    p_supplier_name := 'Sync Test Supplier',
    p_transaction_date := '2026-06-10T12:30:00Z',
    p_client_timezone := 'Pacific/Auckland',
    p_update_product_default := false,
    p_unit_index := NULL,
    p_identifier_type := NULL,
    p_identifier_value := NULL
  );

  SELECT invoice_issue_date, tax_point_date,
         invoice_issue_date_generated, tax_point_date_generated
  INTO v_issue, v_tax, v_issue_gen, v_tax_gen
  FROM public.orders
  WHERE id = v_manual_order_id;
  IF v_issue <> '2026-06-11' OR v_tax <> '2026-06-11' THEN
    RAISE EXCEPTION 'review edit did not follow the reviewer day: % / %', v_issue, v_tax;
  END IF;
  IF v_issue_gen IS DISTINCT FROM false OR v_tax_gen IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'review edit did not mark manual dates explicit';
  END IF;

  -- 3. Legacy generated rows follow the review day and become explicit.
  INSERT INTO public.order_items (id, order_id, name, quantity, price)
  VALUES (v_legacy_item_id, v_legacy_order_id, 'Legacy Fixture Phone', 1, 95000);

  PERFORM public.update_transaction_review_details(
    p_merchant_id := v_merchant_id,
    p_order_id := v_legacy_order_id,
    p_order_item_id := v_legacy_item_id,
    p_product_id := NULL,
    p_variant_id := NULL,
    p_cost_price := 80000,
    p_supplier_name := 'Sync Test Supplier',
    p_transaction_date := '2026-06-10T12:30:00Z',
    p_client_timezone := 'Pacific/Auckland',
    p_update_product_default := false,
    p_unit_index := NULL,
    p_identifier_type := NULL,
    p_identifier_value := NULL
  );

  SELECT invoice_issue_date, tax_point_date,
         invoice_issue_date_generated, tax_point_date_generated
  INTO v_issue, v_tax, v_issue_gen, v_tax_gen
  FROM public.orders
  WHERE id = v_legacy_order_id;
  IF v_issue <> '2026-06-11' OR v_tax <> '2026-06-11' THEN
    RAISE EXCEPTION 'review edit did not follow the reviewer day for generated rows: % / %', v_issue, v_tax;
  END IF;
  IF v_issue_gen IS DISTINCT FROM false OR v_tax_gen IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'review edit did not mark generated dates explicit';
  END IF;

  -- 4. Non-manual explicit overrides survive review day changes, while the
  -- generated date on the same order still follows. The storefront invoice
  -- was issued Mar 10 for a Mar 4 sale; correcting the sale day must not
  -- rewrite the already-issued invoice.
  INSERT INTO public.orders (
    id,
    merchant_id,
    order_number,
    customer_name,
    customer_email,
    total,
    subtotal,
    payment_status,
    shipping_status,
    source,
    transaction_date,
    invoice_issue_date,
    tax_point_date,
    invoice_issue_date_generated,
    tax_point_date_generated
  ) VALUES (
    v_explicit_order_id,
    v_merchant_id,
    format('EXPLICIT-DATE-SYNC-%s', v_run_id),
    'Manual Date Sync Customer',
    format('manual-date-sync-customer-%s@example.com', v_run_id),
    95000,
    95000,
    'paid',
    'pending',
    'storefront',
    '2026-03-04T11:30:00Z',
    '2026-03-10',
    '2026-03-04',
    false,
    true
  );

  INSERT INTO public.order_items (id, order_id, name, quantity, price)
  VALUES (v_explicit_item_id, v_explicit_order_id, 'Explicit Fixture Phone', 1, 95000);

  PERFORM public.update_transaction_review_details(
    p_merchant_id := v_merchant_id,
    p_order_id := v_explicit_order_id,
    p_order_item_id := v_explicit_item_id,
    p_product_id := NULL,
    p_variant_id := NULL,
    p_cost_price := 80000,
    p_supplier_name := 'Sync Test Supplier',
    p_transaction_date := '2026-06-10T12:30:00Z',
    p_client_timezone := 'Pacific/Auckland',
    p_update_product_default := false,
    p_unit_index := NULL,
    p_identifier_type := NULL,
    p_identifier_value := NULL
  );

  SELECT invoice_issue_date, tax_point_date,
         invoice_issue_date_generated, tax_point_date_generated,
         transaction_date
  INTO v_issue, v_tax, v_issue_gen, v_tax_gen, v_txn
  FROM public.orders
  WHERE id = v_explicit_order_id;
  IF v_txn <> '2026-06-10T12:30:00Z' THEN
    RAISE EXCEPTION 'review edit did not move the transaction instant: %', v_txn;
  END IF;
  IF v_issue <> '2026-03-10' OR v_issue_gen IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'review edit rewrote the explicit invoice date: %', v_issue;
  END IF;
  IF v_tax <> '2026-06-11' OR v_tax_gen IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'review edit did not follow the reviewer day for the generated tax date: %', v_tax;
  END IF;

  -- 5. Cost-only reviews preserve the whole date block. Mirrors the real UI
  -- path: a Lagos reviewer sees Jun 10 for the stored instant, leaves the
  -- date field untouched, and the editor re-serializes it as Lagos midnight
  -- (2026-06-09T23:00:00Z) -- a different instant for the same calendar day.
  -- The Auckland-selected Jun 11 dates, flags, and stored instant must survive.
  PERFORM public.update_transaction_review_details(
    p_merchant_id := v_merchant_id,
    p_order_id := v_manual_order_id,
    p_order_item_id := v_item_id,
    p_product_id := NULL,
    p_variant_id := NULL,
    p_cost_price := 125000,
    p_supplier_name := 'Sync Test Supplier',
    p_transaction_date := '2026-06-09T23:00:00Z',
    p_client_timezone := 'Africa/Lagos',
    p_update_product_default := false,
    p_unit_index := NULL,
    p_identifier_type := NULL,
    p_identifier_value := NULL
  );

  SELECT invoice_issue_date, tax_point_date,
         invoice_issue_date_generated, tax_point_date_generated,
         transaction_date
  INTO v_issue, v_tax, v_issue_gen, v_tax_gen, v_txn
  FROM public.orders
  WHERE id = v_manual_order_id;
  IF v_issue <> '2026-06-11' OR v_tax <> '2026-06-11'
     OR v_issue_gen IS DISTINCT FROM false OR v_tax_gen IS DISTINCT FROM false
     OR v_txn <> '2026-06-10T12:30:00Z' THEN
    RAISE EXCEPTION 'cost-only review disturbed document dates: % / %', v_issue, v_tax;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 6. Historical rows (pre-migration shape: recording-day dates stamped by
-- update_order_tax_totals, NULL provenance). The manual and proven-import
-- rows must be repaired to the merchant-timezone day; the unmarked
-- non-manual row stays untouched by design.
-- The DO-block route-context claims above revert at block exit, and the
-- before-insert route-context trigger raises 42501 without a trusted
-- context, so mint the service_role bypass exactly like the storefront
-- replay fixtures (cf. gigl_tracking_order_status_generation.sql).
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.merchants (id, email, business_name, slug, country)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'manual-date-historical@example.com',
  'Manual Date Historical',
  'manual-date-historical',
  'NG'
);

INSERT INTO public.customers (id, merchant_id, email, full_name)
VALUES (
  'b0000000-0000-0000-0000-000000000002',
  'b0000000-0000-0000-0000-000000000001',
  'manual-date-historical@example.com',
  'Historical Manual'
);

INSERT INTO public.orders (
  id, merchant_id, order_number, customer_name, customer_email,
  total, subtotal, payment_status, shipping_status, source,
  transaction_date, invoice_issue_date, tax_point_date,
  invoice_issue_date_generated, tax_point_date_generated,
  import_job_id, external_source, customer_id
) VALUES (
  'b0000000-0000-0000-0000-000000000003',
  'b0000000-0000-0000-0000-000000000001',
  'HISTORICAL-MANUAL-DATE',
  'Historical Manual',
  'manual-date-historical@example.com',
  150000, 150000, 'paid', 'pending', 'physical',
  '2026-03-04T23:30:00Z', '2026-03-04', '2026-03-04', NULL, NULL,
  NULL, NULL, 'b0000000-0000-0000-0000-000000000002'
), (
  'b0000000-0000-0000-0000-000000000004',
  'b0000000-0000-0000-0000-000000000001',
  'HISTORICAL-STOREFRONT-DATE',
  'Historical Storefront',
  'manual-date-historical@example.com',
  150000, 150000, 'paid', 'pending', 'storefront',
  '2026-03-04T23:30:00Z', '2026-03-04', '2026-03-04', NULL, NULL,
  NULL, NULL, NULL
), (
  'b0000000-0000-0000-0000-000000000005',
  'b0000000-0000-0000-0000-000000000001',
  'HISTORICAL-WEBSITE-IMPORT',
  'Historical Import',
  'manual-date-historical@example.com',
  150000, 150000, 'paid', 'pending', 'online_store',
  '2026-03-04T23:30:00Z', '2026-06-01', '2026-06-01', NULL, NULL,
  NULL, 'bumpa', NULL
);
RESET ROLE;

-- Re-apply the backfill migration itself (idempotent by construction) so this
-- check exercises its exact statements rather than a copy.
CREATE TEMPORARY TABLE backfill_updated_guard AS
SELECT id, updated_at FROM public.orders
WHERE id IN (
  'b0000000-0000-0000-0000-000000000003',
  'b0000000-0000-0000-0000-000000000004',
  'b0000000-0000-0000-0000-000000000005'
);
CREATE TEMPORARY TABLE backfill_customer_guard AS
SELECT id, updated_at FROM public.customers
WHERE id = 'b0000000-0000-0000-0000-000000000002';
\ir ../20260912150000_backfill_manual_order_document_dates.sql

DO $$
DECLARE
  v_issue date;
  v_tax date;
  v_issue_gen boolean;
  v_tax_gen boolean;
BEGIN
  SELECT invoice_issue_date, tax_point_date,
         invoice_issue_date_generated, tax_point_date_generated
  INTO v_issue, v_tax, v_issue_gen, v_tax_gen
  FROM public.orders
  WHERE id = 'b0000000-0000-0000-0000-000000000003';
  IF v_issue <> '2026-03-05' OR v_tax <> '2026-03-05'
     OR v_issue_gen IS DISTINCT FROM true OR v_tax_gen IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'backfill did not repair historical manual dates: % / %', v_issue, v_tax;
  END IF;

  SELECT invoice_issue_date, tax_point_date,
         invoice_issue_date_generated, tax_point_date_generated
  INTO v_issue, v_tax, v_issue_gen, v_tax_gen
  FROM public.orders
  WHERE id = 'b0000000-0000-0000-0000-000000000004';
  IF v_issue <> '2026-03-04' OR v_tax <> '2026-03-04'
     OR v_issue_gen IS NOT NULL OR v_tax_gen IS NOT NULL THEN
    RAISE EXCEPTION 'backfill touched a non-manual historical row: % / %', v_issue, v_tax;
  END IF;

  SELECT invoice_issue_date, tax_point_date,
         invoice_issue_date_generated, tax_point_date_generated
  INTO v_issue, v_tax, v_issue_gen, v_tax_gen
  FROM public.orders
  WHERE id = 'b0000000-0000-0000-0000-000000000005';
  IF v_issue <> '2026-03-05' OR v_tax <> '2026-03-05'
     OR v_issue_gen IS DISTINCT FROM true OR v_tax_gen IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'backfill did not repair historical import dates: % / %', v_issue, v_tax;
  END IF;

  -- 7. Re-applying the migration preserves the explicit physical fixture: a
  -- Lagos recompute of its instant would yield Jun 10, so Jun 11 plus FALSE
  -- flags proves the init left explicit provenance alone.
  SELECT invoice_issue_date, tax_point_date,
         invoice_issue_date_generated, tax_point_date_generated
  INTO v_issue, v_tax, v_issue_gen, v_tax_gen
  FROM public.orders
  WHERE id = 'c0000000-0000-0000-0000-000000000001';
  IF v_issue <> '2026-06-11' OR v_tax <> '2026-06-11'
     OR v_issue_gen IS DISTINCT FROM false OR v_tax_gen IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'migration replay clobbered explicit manual dates: % / %', v_issue, v_tax;
  END IF;

  -- 8. The backfill disables the updated_at trigger, so repaired rows keep
  -- their original recency instead of looking modified at deploy time.
  IF EXISTS (
    SELECT 1
    FROM public.orders AS o
    JOIN backfill_updated_guard AS g ON g.id = o.id
    WHERE o.updated_at IS DISTINCT FROM g.updated_at
  ) THEN
    RAISE EXCEPTION 'backfill bumped updated_at on historical rows';
  END IF;

  -- 9. The backfill changes no order totals, so the paused customer-stats
  -- trigger must leave linked customer timestamps (OCC tokens) untouched.
  IF EXISTS (
    SELECT 1
    FROM public.customers AS c
    JOIN backfill_customer_guard AS g ON g.id = c.id
    WHERE c.updated_at IS DISTINCT FROM g.updated_at
  ) THEN
    RAISE EXCEPTION 'backfill churned linked customer timestamps';
  END IF;
END;
$$ LANGUAGE plpgsql;

ROLLBACK;

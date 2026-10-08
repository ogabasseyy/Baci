-- =============================================
-- REGRESSION TEST: mobile-admin transaction-review search RPC
--
-- Validates search_mobile_admin_transaction_review_orders: multi-term AND
-- matching across order/item/product/variant fields, paid + visibility +
-- cancelled exclusions, LIKE-wildcard literal handling, limit ordering, and
-- the merchant-access boundary.
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/search_mobile_admin_transaction_review_orders.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF to_regprocedure(
    'public.search_mobile_admin_transaction_review_orders(uuid,text[],integer,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'transaction review search function is missing';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.search_mobile_admin_transaction_review_orders(uuid,text[],integer,integer)'::regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated search execute grant is missing';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.search_mobile_admin_transaction_review_orders(uuid,text[],integer,integer)'::regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anonymous search execute grant must remain revoked';
  END IF;
END;
$$ LANGUAGE plpgsql;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'search-test-owner-a@example.com',
  'test',
  now(),
  now(),
  now(),
  '{}'::jsonb,
  '{}'::jsonb
), (
  '22222222-2222-4222-8222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'search-test-owner-b@example.com',
  'test',
  now(),
  now(),
  now(),
  '{}'::jsonb,
  '{}'::jsonb
), (
  '33333333-3333-4333-8333-333333333333',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'search-test-staff-a@example.com',
  'test',
  now(),
  now(),
  now(),
  '{}'::jsonb,
  '{}'::jsonb
);

INSERT INTO public.merchants (id, user_id, email) VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'search-test-a@example.com'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',
    'search-test-b@example.com'
  );

-- Active staff without ledger rights: explicit false on every path
-- check_staff_permission reads (including wildcards), so the denial holds
-- regardless of the role's defaults.
INSERT INTO public.staff_members (
  id, merchant_id, user_id, email, name, role, permissions, status
) VALUES (
  'e0000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '33333333-3333-4333-8333-333333333333',
  'search-test-staff-a@example.com',
  'Search Staff',
  'sales_rep',
  '{"*": {"*": false, "edit": false, "view": false}, "orders": {"*": false, "edit": false, "all": false}, "analytics": {"*": false, "view": false, "all": false}, "full_access": {"all": false}}'::jsonb,
  'active'
);

INSERT INTO public.products (id, merchant_id, name, price, sku, metadata) VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Phone X',
    500,
    'PHX-BLK',
    '{"supplier": "Acme Mobile"}'::jsonb
  );

INSERT INTO public.product_variants (
  id, product_id, merchant_id, sku, condition, attributes
) VALUES (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'PHX-BLK-128',
  'new',
  '{"color": "black"}'::jsonb
);

-- Cross-merchant catalog references: merchant B's product/variant text must
-- never satisfy a match for merchant A's order, even when referenced.
-- Seeded as owner B: the products/variants INSERT policies require
-- merchant ownership.
SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);
INSERT INTO public.products (id, merchant_id, name, price, sku) VALUES (
  '10000000-0000-4000-8000-000000000002',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'Foreign Phone',
  700,
  'XMERCHANT-SKU-7'
);

INSERT INTO public.product_variants (
  id, product_id, merchant_id, sku, condition
) VALUES (
  '20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'XMERCHANT-VAR-7',
  'new'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

-- The cross-merchant item insert lives with the order-item seeds below,
-- after the referenced order exists.

-- Target order: paid, visible, IMEI in ITEM fulfillment_data.
INSERT INTO public.orders (
  id, merchant_id, order_number, customer_name, customer_email, customer_phone,
  shipping_status, payment_status, total, payment_method, fulfillment_details,
  created_at
) VALUES (
  'c0000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'ORD-1001',
  'Ada Lovelace',
  'ada@example.com',
  '+2348000000001',
  'pending',
  'paid',
  500.00,
  'paystack',
  '{"note": "fragile"}'::jsonb,
  '2026-10-05T10:00:00Z'
);

INSERT INTO public.order_items (
  id, order_id, product_id, name, price, quantity, fulfillment_data, variant_id
) VALUES (
  'd0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Phone X',
  500.00,
  1,
  '{"inventoryUnits": [{"imei": "353232106161443", "serial": "SN-999"}]}'::jsonb,
  '20000000-0000-4000-8000-000000000001'
);

-- Cross-merchant catalog reference (see product seeds above).
INSERT INTO public.order_items (
  id, order_id, product_id, name, price, quantity, variant_id
) VALUES (
  'd0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  'Foreign Reference',
  1.00,
  1,
  '20000000-0000-4000-8000-000000000002'
);

-- Per-unit IMEI/supplier persisted only in the unit-cost ledger.
INSERT INTO public.order_item_unit_costs (
  merchant_id, order_id, order_item_id, unit_index, cost_price, supplier_name,
  identifier_type, identifier_value
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  0,
  400.00,
  'UnitCost Vendor',
  'imei',
  '355555550000001'
);

-- Order-level IMEI in fulfillment_details.
INSERT INTO public.orders (
  id, merchant_id, order_number, customer_name, shipping_status, payment_status,
  total, fulfillment_details, created_at, transaction_date
) VALUES (
  'c0000000-0000-4000-8000-000000000002',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'ORD-1002',
  'Grace Hopper',
  'pending',
  'paid',
  250.00,
  '{"imei": "354066782325743"}'::jsonb,
  '2026-10-06T10:00:00Z',
  '2026-10-06T10:00:00Z'
);

-- Newly created but backdated order: ranking follows transaction date.
INSERT INTO public.orders (
  id, merchant_id, order_number, customer_name, shipping_status, payment_status,
  total, created_at, transaction_date
) VALUES (
  'c0000000-0000-4000-8000-000000000007',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'ORD-1007',
  'Back Dated',
  'pending',
  'paid',
  100.00,
  '2026-10-07T12:00:00Z',
  '2026-09-15T12:00:00Z'
);

-- Recent null-date order outranks ancient dated orders under the cap.
INSERT INTO public.orders (
  id, merchant_id, order_number, customer_name, shipping_status, payment_status,
  total, created_at
) VALUES (
  'c0000000-0000-4000-8000-000000000008',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'RANK-RECENT-NULL',
  'Rank Recent',
  'pending',
  'paid',
  100.00,
  '2026-10-08T12:00:00Z'
);

INSERT INTO public.orders (
  id, merchant_id, order_number, customer_name, shipping_status, payment_status,
  total, created_at, transaction_date
) VALUES (
  'c0000000-0000-4000-8000-000000000009',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'RANK-ANCIENT-DATED',
  'Rank Ancient',
  'pending',
  'paid',
  100.00,
  '2026-10-01T12:00:00Z',
  '2020-05-05T12:00:00Z'
);

-- Equal effective transaction dates (midnight edits): the capped set must
-- prefer the newer-created row over UUID order. Ids deliberately
-- anti-align with creation order so the tie-break is observable.
INSERT INTO public.orders (
  id, merchant_id, order_number, customer_name, shipping_status, payment_status,
  total, created_at, transaction_date
) VALUES (
  'c0000000-0000-4000-8000-000000000010',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'TIE-NEWER',
  'Tiebreaker Newer',
  'pending',
  'paid',
  100.00,
  '2026-10-03T12:00:00Z',
  '2026-09-20T00:00:00Z'
);

INSERT INTO public.orders (
  id, merchant_id, order_number, customer_name, shipping_status, payment_status,
  total, created_at, transaction_date
) VALUES (
  'c0000000-0000-4000-8000-000000000011',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'TIE-OLDER',
  'Tiebreaker Older',
  'pending',
  'paid',
  100.00,
  '2026-10-01T12:00:00Z',
  '2026-09-20T00:00:00Z'
);

-- Unpaid order: must never match.
INSERT INTO public.orders (
  id, merchant_id, order_number, customer_name, shipping_status, payment_status,
  total, created_at
) VALUES (
  'c0000000-0000-4000-8000-000000000003',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'ORD-1003',
  'Ada Unpaid',
  'pending',
  'unpaid',
  100.00,
  '2026-10-06T11:00:00Z'
);

-- Returned order: excluded shipping status.
INSERT INTO public.orders (
  id, merchant_id, order_number, customer_name, shipping_status, payment_status,
  total, created_at
) VALUES (
  'c0000000-0000-4000-8000-000000000004',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'ORD-1004',
  'Ada Returned',
  'returned',
  'paid',
  100.00,
  '2026-10-06T12:00:00Z'
);

-- Cancelled order: excluded via cancelled_at.
INSERT INTO public.orders (
  id, merchant_id, order_number, customer_name, shipping_status, payment_status,
  total, cancelled_at, created_at
) VALUES (
  'c0000000-0000-4000-8000-000000000005',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'ORD-1005',
  'Ada Cancelled',
  'pending',
  'paid',
  100.00,
  '2026-10-06T12:00:00Z',
  '2026-10-06T12:00:00Z'
);

-- Other merchant's paid order with the same IMEI: tenant isolation.
INSERT INTO public.orders (
  id, merchant_id, order_number, customer_name, shipping_status, payment_status,
  total, fulfillment_details, created_at
) VALUES (
  'c0000000-0000-4000-8000-000000000006',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'ORD-2001',
  'Eve Other',
  'pending',
  'paid',
  100.00,
  '{"imei": "353232106161443"}'::jsonb,
  '2026-10-06T10:00:00Z'
);

SET LOCAL ROLE authenticated;

DO $test$
DECLARE
  v_merchant_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_other_merchant_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_item_imei_order_id uuid := 'c0000000-0000-4000-8000-000000000001';
  v_order_imei_order_id uuid := 'c0000000-0000-4000-8000-000000000002';
  v_ids uuid[];
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config(
    'request.jwt.claim.sub',
    '11111111-1111-4111-8111-111111111111',
    false
  );

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['353232106161443']
  );
  IF v_ids IS DISTINCT FROM ARRAY[v_item_imei_order_id] THEN
    RAISE EXCEPTION 'item-level IMEI search failed: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['354066782325743']
  );
  IF v_ids IS DISTINCT FROM ARRAY[v_order_imei_order_id] THEN
    RAISE EXCEPTION 'order-level IMEI search failed: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['ada', 'sn-999']
  );
  IF v_ids IS DISTINCT FROM ARRAY[v_item_imei_order_id] THEN
    RAISE EXCEPTION 'multi-term search failed: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['ada', 'grace']
  );
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'multi-term AND unexpectedly matched: %', v_ids;
  END IF;

  SELECT array_agg(order_id ORDER BY order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['ada']
  );
  IF v_ids IS DISTINCT FROM ARRAY[v_item_imei_order_id] THEN
    RAISE EXCEPTION 'unpaid/returned/cancelled exclusion failed: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['PHX-BLK-128']
  );
  IF v_ids IS DISTINCT FROM ARRAY[v_item_imei_order_id] THEN
    RAISE EXCEPTION 'variant SKU search failed: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['acme']
  );
  IF v_ids IS DISTINCT FROM ARRAY[v_item_imei_order_id] THEN
    RAISE EXCEPTION 'product metadata search failed: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['xmerchant-sku-7']
  );
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'cross-merchant product text must not match: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['xmerchant-var-7']
  );
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'cross-merchant variant text must not match: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['355555550000001']
  );
  IF v_ids IS DISTINCT FROM ARRAY[v_item_imei_order_id] THEN
    RAISE EXCEPTION 'unit-cost identifier search failed: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['unitcost vendor']
  );
  IF v_ids IS DISTINCT FROM ARRAY[v_item_imei_order_id] THEN
    RAISE EXCEPTION 'unit-cost supplier search failed: %', v_ids;
  END IF;

  -- Staff without orders:edit or analytics:view keeps membership search
  -- but must not match through the unit-cost ledger: the RPC is SECURITY
  -- DEFINER, so it must enforce the ledger's narrower SELECT policy itself.
  PERFORM set_config(
    'request.jwt.claim.sub',
    '33333333-3333-4333-8333-333333333333',
    false
  );

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['355555550000001']
  );
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'ledger identifier must stay hidden from staff: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['unitcost vendor']
  );
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'ledger supplier must stay hidden from staff: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['353232106161443']
  );
  IF v_ids IS DISTINCT FROM ARRAY[v_item_imei_order_id] THEN
    RAISE EXCEPTION 'membership search must still work for staff: %', v_ids;
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub',
    '11111111-1111-4111-8111-111111111111',
    false
  );

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY[
      'ord-1001', 'ada', 'lovelace', 'paystack', 'fragile', 'phone', 'acme',
      'black', 'sn-999', '353232106161443', '355555550000001', 'zzz-no-match'
    ]
  );
  IF v_ids IS DISTINCT FROM ARRAY[v_item_imei_order_id] THEN
    RAISE EXCEPTION 'over-cap term search failed: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['35323210616144_']
  );
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'underscore wildcard was not literal: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['%']
  );
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'percent wildcard was not literal: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['', '  ']
  );
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'blank terms unexpectedly matched: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['paystack']
  );
  IF v_ids IS DISTINCT FROM ARRAY[v_item_imei_order_id] THEN
    RAISE EXCEPTION 'payment method search failed: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['2026-10-05']
  );
  IF v_ids IS DISTINCT FROM ARRAY[v_item_imei_order_id] THEN
    RAISE EXCEPTION 'date search failed: %', v_ids;
  END IF;

  -- ORD-1007 was created Oct 7 but backdated to Sep 15: the client only
  -- carries the effective date, so a creation-date search must not match
  -- while the effective-date search must.
  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['2026-10-07']
  );
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'creation date must not match when backdated: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['2026-09-15']
  );
  IF v_ids IS DISTINCT FROM
    ARRAY['c0000000-0000-4000-8000-000000000007'::uuid] THEN
    RAISE EXCEPTION 'effective date search failed: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['ORD-'],
    1
  );
  IF v_ids IS DISTINCT FROM ARRAY[v_order_imei_order_id] THEN
    RAISE EXCEPTION 'limit did not return the most recent match: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['ORD-100'],
    1
  );
  IF v_ids IS DISTINCT FROM ARRAY[v_order_imei_order_id] THEN
    RAISE EXCEPTION 'limit did not rank by transaction date: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['RANK-'],
    1
  );
  IF v_ids IS DISTINCT FROM
    ARRAY['c0000000-0000-4000-8000-000000000008'::uuid] THEN
    RAISE EXCEPTION 'limit buried a recent null-date match: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['tiebreaker']
  );
  IF v_ids IS DISTINCT FROM
    ARRAY[
      'c0000000-0000-4000-8000-000000000010'::uuid,
      'c0000000-0000-4000-8000-000000000011'::uuid
    ] THEN
    RAISE EXCEPTION 'equal transaction dates must break by creation time: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['tiebreaker'],
    1,
    1
  );
  IF v_ids IS DISTINCT FROM
    ARRAY['c0000000-0000-4000-8000-000000000011'::uuid] THEN
    RAISE EXCEPTION 'search offset skipped ranked candidates: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['tiebreaker'],
    1,
    2
  );
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'search offset past the end must return no rows: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['inventoryunits']
  );
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'JSON keys must never match: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['500']
  );
  IF v_ids IS DISTINCT FROM ARRAY[v_item_imei_order_id] THEN
    RAISE EXCEPTION 'numeric search failed: %', v_ids;
  END IF;

  SELECT array_agg(order_id)
  INTO v_ids
  FROM public.search_mobile_admin_transaction_review_orders(
    v_merchant_id,
    ARRAY['500.00']
  );
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'numeric formatting must match client text: %', v_ids;
  END IF;

  BEGIN
    PERFORM public.search_mobile_admin_transaction_review_orders(
      v_other_merchant_id,
      ARRAY['353232106161443']
    );
    RAISE EXCEPTION 'cross-merchant search unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'insufficient_privilege' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.search_mobile_admin_transaction_review_orders(
      NULL,
      ARRAY['353232106161443']
    );
    RAISE EXCEPTION 'null merchant search unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'merchant_id_required' THEN
      RAISE;
    END IF;
  END;
END;
$test$ LANGUAGE plpgsql;

RESET ROLE;

ROLLBACK;

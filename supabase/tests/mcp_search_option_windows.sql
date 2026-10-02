-- Search option hydration receives per-product storefront windows directly
-- from the database; it must not transfer every variant/offer first.
BEGIN;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published, is_platform_admin)
VALUES
  ('e4100000-0000-4000-8000-000000000001', 'mcp-options-public@example.test', 'MCP Options Public', 'mcp-options-public', true, false),
  ('e4100000-0000-4000-8000-000000000002', 'mcp-options-private@example.test', 'MCP Options Private', 'mcp-options-private', false, false),
  ('e4100000-0000-4000-8000-000000000003', 'mcp-options-admin@example.test', 'MCP Options Admin', 'mcp-options-admin', false, true);

INSERT INTO public.products (id, merchant_id, name, price, status, has_variants, has_condition_offers)
VALUES
  ('e4100000-0000-4000-8000-000000000011', 'e4100000-0000-4000-8000-000000000001', 'Wide option product', 50000, 'active', true, true),
  ('e4100000-0000-4000-8000-000000000012', 'e4100000-0000-4000-8000-000000000001', 'Second product', 50000, 'active', true, true),
  ('e4100000-0000-4000-8000-000000000013', 'e4100000-0000-4000-8000-000000000001', 'Draft product', 50000, 'draft', true, true),
  ('e4100000-0000-4000-8000-000000000014', 'e4100000-0000-4000-8000-000000000002', 'Unpublished product', 50000, 'active', true, true),
  ('e4100000-0000-4000-8000-000000000015', 'e4100000-0000-4000-8000-000000000003', 'Admin product', 50000, 'active', true, true);

-- The anchor override is the anon-blind case: product policy off with a
-- serialized_strict anchor, whose units the projection must count.
INSERT INTO public.products (id, merchant_id, name, price, status, has_variants, inventory_tracking_policy)
VALUES
  ('e4100000-0000-4000-8000-000000000016', 'e4100000-0000-4000-8000-000000000001', 'Serialized simple', 50000, 'active', false, 'off'),
  ('e4100000-0000-4000-8000-000000000017', 'e4100000-0000-4000-8000-000000000001', 'Plain simple', 50000, 'active', false, 'off');

INSERT INTO public.product_variants (id, product_id, merchant_id, is_inventory_anchor, inventory_tracking_policy)
VALUES
  ('e4100000-0000-4000-8000-000000000207', 'e4100000-0000-4000-8000-000000000016',
   'e4100000-0000-4000-8000-000000000001', true, 'serialized_strict');

INSERT INTO public.variant_inventory (merchant_id, variant_id, identifier_type, identifier_value, status)
VALUES (
  'e4100000-0000-4000-8000-000000000001',
  'e4100000-0000-4000-8000-000000000207',
  'serial',
  'SER-ANCHOR-1',
  'available'
);

INSERT INTO public.product_variants
  (id, product_id, merchant_id, attributes, price_override, stock_quantity, created_at)
SELECT
  ('e4100000-0000-4000-8000-' || pg_catalog.lpad(index_value::text, 12, '0'))::uuid,
  'e4100000-0000-4000-8000-000000000011',
  'e4100000-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_object('storage_gb', index_value),
  index_value,
  CASE WHEN index_value = 1 THEN 0 ELSE 1 END,
  '2026-01-01 00:00:00+00'::timestamptz
FROM pg_catalog.generate_series(1, 130) AS series(index_value);

INSERT INTO public.product_variants
  (id, product_id, merchant_id, attributes, price_override, stock_quantity)
VALUES
  ('e4100000-0000-4000-8000-000000000201', 'e4100000-0000-4000-8000-000000000012', 'e4100000-0000-4000-8000-000000000001', '{"storage_gb":256}', 100, 2),
  ('e4100000-0000-4000-8000-000000000202', 'e4100000-0000-4000-8000-000000000013', 'e4100000-0000-4000-8000-000000000001', '{"storage_gb":128}', 100, 2),
  ('e4100000-0000-4000-8000-000000000203', 'e4100000-0000-4000-8000-000000000014', 'e4100000-0000-4000-8000-000000000002', '{"storage_gb":128}', 100, 2),
  ('e4100000-0000-4000-8000-000000000205', 'e4100000-0000-4000-8000-000000000015', 'e4100000-0000-4000-8000-000000000003', '{"storage_gb":256}', 100, 2);

INSERT INTO public.product_offers
  (id, product_id, merchant_id, condition, price, compare_at_price, stock_quantity, status)
VALUES
  ('e4100000-0000-4000-8000-000000000301', 'e4100000-0000-4000-8000-000000000011', 'e4100000-0000-4000-8000-000000000001', 'new', 20001, 30001, 1, 'active'),
  ('e4100000-0000-4000-8000-000000000302', 'e4100000-0000-4000-8000-000000000011', 'e4100000-0000-4000-8000-000000000001', 'open_box', 20002, 30002, 1, 'active'),
  ('e4100000-0000-4000-8000-000000000303', 'e4100000-0000-4000-8000-000000000011', 'e4100000-0000-4000-8000-000000000001', 'used', 20003, 30003, 1, 'active'),
  ('e4100000-0000-4000-8000-000000000304', 'e4100000-0000-4000-8000-000000000011', 'e4100000-0000-4000-8000-000000000001', 'refurbished', 20004, 30004, 1, 'active');

INSERT INTO public.product_offers
  (id, product_id, merchant_id, condition, price, stock_quantity, status)
VALUES
  ('e4100000-0000-4000-8000-000000000401', 'e4100000-0000-4000-8000-000000000012', 'e4100000-0000-4000-8000-000000000001', 'new', 100, 1, 'active'),
  ('e4100000-0000-4000-8000-000000000402', 'e4100000-0000-4000-8000-000000000013', 'e4100000-0000-4000-8000-000000000001', 'new', 100, 1, 'active'),
  ('e4100000-0000-4000-8000-000000000403', 'e4100000-0000-4000-8000-000000000014', 'e4100000-0000-4000-8000-000000000002', 'new', 100, 1, 'active'),
  ('e4100000-0000-4000-8000-000000000405', 'e4100000-0000-4000-8000-000000000015', 'e4100000-0000-4000-8000-000000000003', 'new', 100, 1, 'active');

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

DO $$
DECLARE
  v_count integer;
  v_max_price numeric;
  v_offer_ids uuid[];
  v_policy text;
  v_units integer;
BEGIN
  SELECT option_row.effective_policy INTO v_policy
  FROM public.get_mcp_search_product_variants(
    ARRAY['e4100000-0000-4000-8000-000000000012'::uuid],
    'e4100000-0000-4000-8000-000000000001'
  ) AS option_row;
  IF v_policy IS DISTINCT FROM 'off' THEN
    RAISE EXCEPTION 'variant RPC must project the resolved effective policy, got %', v_policy;
  END IF;

  SELECT anchor_row.effective_policy, anchor_row.available_units
  INTO v_policy, v_units
  FROM public.get_mcp_search_serialized_anchor_policies(
    ARRAY[
      'e4100000-0000-4000-8000-000000000011'::uuid,
      'e4100000-0000-4000-8000-000000000016'::uuid,
      'e4100000-0000-4000-8000-000000000017'::uuid
    ],
    'e4100000-0000-4000-8000-000000000001'
  ) AS anchor_row;
  IF v_policy IS DISTINCT FROM 'serialized_strict' OR v_units IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'anchor projection must resolve the strict override with its units, got %/%', v_policy, v_units;
  END IF;

  SELECT pg_catalog.count(*) INTO v_count
  FROM public.get_mcp_search_serialized_anchor_policies(
    ARRAY[
      'e4100000-0000-4000-8000-000000000011'::uuid,
      'e4100000-0000-4000-8000-000000000016'::uuid,
      'e4100000-0000-4000-8000-000000000017'::uuid
    ],
    'e4100000-0000-4000-8000-000000000001'
  );
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'anchor projection must omit variant products and off-policy simples, got % rows', v_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.get_mcp_search_serialized_anchor_policies(
      ARRAY['e4100000-0000-4000-8000-000000000016'::uuid],
      'e4100000-0000-4000-8000-000000000002'
    )
  ) THEN
    RAISE EXCEPTION 'a different merchant retrieved the anchor projection';
  END IF;

  SELECT pg_catalog.count(*), pg_catalog.max(option_row.price_override)
  INTO v_count, v_max_price
  FROM public.get_mcp_search_product_variants(
    ARRAY[
      'e4100000-0000-4000-8000-000000000011'::uuid,
      'e4100000-0000-4000-8000-000000000012'::uuid,
      'e4100000-0000-4000-8000-000000000013'::uuid,
      'e4100000-0000-4000-8000-000000000014'::uuid
    ],
    'e4100000-0000-4000-8000-000000000001'
  ) AS option_row
  WHERE option_row.product_id = 'e4100000-0000-4000-8000-000000000011';
  IF v_count <> 129 OR v_max_price <> 129 THEN
    RAISE EXCEPTION 'variant RPC must return the 128-row window plus its sentinel, got % rows/max price %', v_count, v_max_price;
  END IF;

  SELECT pg_catalog.count(*) INTO v_count
  FROM public.get_mcp_search_product_variants(
    ARRAY['e4100000-0000-4000-8000-000000000012'::uuid],
    'e4100000-0000-4000-8000-000000000001'
  ) AS option_row;
  IF v_count <> 1 THEN RAISE EXCEPTION 'second product option was lost across per-product windows'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.get_mcp_search_product_variants(
      ARRAY['e4100000-0000-4000-8000-000000000011'::uuid],
      'e4100000-0000-4000-8000-000000000002'
    )
  ) THEN
    RAISE EXCEPTION 'a different merchant retrieved the published merchant variants';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.get_mcp_search_product_variants(
      ARRAY['e4100000-0000-4000-8000-000000000013'::uuid],
      'e4100000-0000-4000-8000-000000000001'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.get_mcp_search_product_variants(
      ARRAY['e4100000-0000-4000-8000-000000000014'::uuid],
      'e4100000-0000-4000-8000-000000000002'
    )
  ) THEN
    RAISE EXCEPTION 'variant RPC exposed draft or unpublished products';
  END IF;

  SELECT pg_catalog.count(*), pg_catalog.array_agg(option_row.id ORDER BY option_row.condition, option_row.id)
  INTO v_count, v_offer_ids
  FROM public.get_mcp_search_product_offers(
    ARRAY[
      'e4100000-0000-4000-8000-000000000011'::uuid,
      'e4100000-0000-4000-8000-000000000012'::uuid,
      'e4100000-0000-4000-8000-000000000013'::uuid,
      'e4100000-0000-4000-8000-000000000014'::uuid
    ],
    'e4100000-0000-4000-8000-000000000001'
  ) AS option_row
  WHERE option_row.product_id = 'e4100000-0000-4000-8000-000000000011';
  IF v_count <> 4
    OR v_offer_ids IS DISTINCT FROM ARRAY[
      'e4100000-0000-4000-8000-000000000301'::uuid,
      'e4100000-0000-4000-8000-000000000302'::uuid,
      'e4100000-0000-4000-8000-000000000304'::uuid,
      'e4100000-0000-4000-8000-000000000303'::uuid
    ] THEN
    RAISE EXCEPTION 'offer RPC must preserve legal ordered condition offers, got % rows: %', v_count, v_offer_ids;
  END IF;

  SELECT pg_catalog.count(*) INTO v_count
  FROM public.get_mcp_search_product_offers(
    ARRAY['e4100000-0000-4000-8000-000000000012'::uuid],
    'e4100000-0000-4000-8000-000000000001'
  );
  IF v_count <> 1 THEN RAISE EXCEPTION 'second product offer was lost across per-product windows'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.get_mcp_search_product_offers(
      ARRAY['e4100000-0000-4000-8000-000000000011'::uuid],
      'e4100000-0000-4000-8000-000000000002'
    )
  ) THEN
    RAISE EXCEPTION 'a different merchant retrieved the published merchant offers';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.get_mcp_search_product_offers(
      ARRAY['e4100000-0000-4000-8000-000000000013'::uuid],
      'e4100000-0000-4000-8000-000000000001'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.get_mcp_search_product_offers(
      ARRAY['e4100000-0000-4000-8000-000000000014'::uuid],
      'e4100000-0000-4000-8000-000000000002'
    )
  ) THEN
    RAISE EXCEPTION 'offer RPC exposed draft or unpublished products';
  END IF;

  SELECT pg_catalog.count(*) INTO v_count
  FROM public.get_mcp_search_product_variants(
    ARRAY['e4100000-0000-4000-8000-000000000015'::uuid],
    'e4100000-0000-4000-8000-000000000003'
  );
  IF v_count <> 1 THEN RAISE EXCEPTION 'variant RPC hid a platform-admin storefront product'; END IF;

  SELECT pg_catalog.count(*) INTO v_count
  FROM public.get_mcp_search_product_offers(
    ARRAY['e4100000-0000-4000-8000-000000000015'::uuid],
    'e4100000-0000-4000-8000-000000000003'
  );
  IF v_count <> 1 THEN RAISE EXCEPTION 'offer RPC hid a platform-admin storefront product'; END IF;

  BEGIN
    PERFORM * FROM public.get_mcp_search_product_variants(
      ARRAY(SELECT pg_catalog.gen_random_uuid() FROM pg_catalog.generate_series(1, 101)),
      'e4100000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'variant RPC accepted more than 100 product IDs';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM public.get_mcp_search_product_offers(
      ARRAY(SELECT pg_catalog.gen_random_uuid() FROM pg_catalog.generate_series(1, 101)),
      'e4100000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'offer RPC accepted more than 100 product IDs';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END;
$$;

RESET ROLE;
ROLLBACK;

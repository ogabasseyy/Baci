-- Canonical anchor availability is checked independently of browse text filtering.
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES
  ('e5100000-0000-4000-8000-000000000604', 'browse-anchor@example.test',
   'Browse Anchor Merchant', 'browse-anchor-merchant', true);

-- Anchor fixtures live on their own merchant: a stocked strict anchor
-- and an anchor-override stocked twin stay, a unit-less strict anchor
-- drops, and a zero-unit unlimited anchor stays (unlimited never reads
-- as sold out).
INSERT INTO public.products
  (id, merchant_id, name, slug, brand, category, price, status, created_at, condition, has_variants, manage_stock, stock_quantity, inventory_tracking_policy, discovery_metadata)
VALUES
  ('e5100000-0000-4000-8000-000000000640', 'e5100000-0000-4000-8000-000000000604',
   'Strict anchor stocked', 'strict-anchor-stocked', 'Anch', 'Audio', 50000, 'active', '2024-01-01T00:00:00Z', 'new', false, true, 0, 'serialized_strict', '{}'),
  ('e5100000-0000-4000-8000-000000000642', 'e5100000-0000-4000-8000-000000000604',
   'Strict anchor depleted', 'strict-anchor-depleted', 'Anch', 'Audio', 50000, 'active', '2024-01-01T00:00:00Z', 'new', false, true, 0, 'serialized_strict', '{}'),
  ('e5100000-0000-4000-8000-000000000644', 'e5100000-0000-4000-8000-000000000604',
   'Unlimited anchor zero', 'unlimited-anchor-zero', 'Anch', 'Audio', 50000, 'active', '2024-01-01T00:00:00Z', 'new', false, true, 0, 'serialized_then_unlimited', '{}'),
  ('e5100000-0000-4000-8000-000000000646', 'e5100000-0000-4000-8000-000000000604',
   'Anchor override stocked', 'anchor-override-stocked', 'Anch', 'Audio', 50000, 'active', '2024-01-01T00:00:00Z', 'new', false, true, 0, 'off', '{}');

INSERT INTO public.product_variants
  (id, product_id, merchant_id, attributes, stock_quantity, condition,
   is_inventory_anchor, inventory_tracking_policy)
VALUES
  ('e5100000-0000-4000-8000-000000000641', 'e5100000-0000-4000-8000-000000000640',
   'e5100000-0000-4000-8000-000000000604', '{"role":"anchor"}', 0, 'new', true, 'inherit'),
  ('e5100000-0000-4000-8000-000000000643', 'e5100000-0000-4000-8000-000000000642',
   'e5100000-0000-4000-8000-000000000604', '{"role":"anchor"}', 0, 'new', true, 'inherit'),
  ('e5100000-0000-4000-8000-000000000645', 'e5100000-0000-4000-8000-000000000644',
   'e5100000-0000-4000-8000-000000000604', '{"role":"anchor"}', 0, 'new', true, 'inherit'),
  ('e5100000-0000-4000-8000-000000000647', 'e5100000-0000-4000-8000-000000000646',
   'e5100000-0000-4000-8000-000000000604', '{"role":"anchor"}', 0, 'new', true, 'serialized_strict');

INSERT INTO public.variant_inventory
  (variant_id, merchant_id, identifier_type, identifier_value, status)
VALUES
  ('e5100000-0000-4000-8000-000000000641', 'e5100000-0000-4000-8000-000000000604',
   'serial', 'AVAIL-604-1', 'available'),
  ('e5100000-0000-4000-8000-000000000647', 'e5100000-0000-4000-8000-000000000604',
   'serial', 'AVAIL-604-2', 'available');

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
DO $$
DECLARE browse_ids uuid[];
BEGIN
  -- Anchor-resolved availability: the stocked strict anchor, the
  -- zero-unit unlimited anchor, and the anchor-override twin stay; the
  -- unit-less strict anchor drops with stored stock at zero.
  SELECT array_agg(id) INTO browse_ids
  FROM public.search_products_browse(
    p_merchant_id => 'e5100000-0000-4000-8000-000000000604',
    p_limit => 10
  );
  IF cardinality(browse_ids) IS DISTINCT FROM 3
    OR NOT (browse_ids @> ARRAY[
      'e5100000-0000-4000-8000-000000000640'::uuid,
      'e5100000-0000-4000-8000-000000000644'::uuid,
      'e5100000-0000-4000-8000-000000000646'::uuid
    ])
    OR browse_ids @> ARRAY['e5100000-0000-4000-8000-000000000642'::uuid] THEN
    RAISE EXCEPTION 'anchor browse must keep resolved bases only, got %', browse_ids;
  END IF;
END;
$$;
ROLLBACK;

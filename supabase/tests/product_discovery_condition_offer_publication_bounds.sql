-- Public condition matching must ignore unpublished products and use the
-- bounded ordered offer projection shared with search hydration.
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES
  ('cb58d110-0000-4000-8000-000000000670', 'condition-public@example.test',
   'Condition Public Test', 'condition-public-test', true),
  ('cb58d110-0000-4000-8000-000000000671', 'condition-hidden@example.test',
   'Condition Hidden Test', 'condition-hidden-test', false);

INSERT INTO public.products
  (id, merchant_id, name, slug, price, status, has_variants, condition,
   manage_stock, stock_quantity)
VALUES
  ('cb58d110-0000-4000-8000-000000000672', 'cb58d110-0000-4000-8000-000000000670',
   'Published bounded offers', 'published-bounded-offers', 100, 'active', false,
   'new', true, 0),
  ('cb58d110-0000-4000-8000-000000000673', 'cb58d110-0000-4000-8000-000000000671',
   'Unpublished offer product', 'unpublished-offer-product', 100, 'active', false,
   'new', false, 0),
  ('cb58d110-0000-4000-8000-000000000675', 'cb58d110-0000-4000-8000-000000000670',
   'Published in-window offer', 'published-in-window-offer', 100, 'active', false,
   'new', true, 0);

-- Legacy nullable stock-management flags are managed, as on the PDP.
INSERT INTO public.products
  (id, merchant_id, name, slug, price, status, has_variants, manage_stock, stock_quantity)
VALUES
  ('cb58d110-0000-4000-8000-000000000678', 'cb58d110-0000-4000-8000-000000000670',
   'Nullable depleted base', 'nullable-depleted-base', 100, 'active', false, NULL, 0),
  ('cb58d110-0000-4000-8000-000000000679', 'cb58d110-0000-4000-8000-000000000670',
   'Nullable stocked base', 'nullable-stocked-base', 100, 'active', false, NULL, 2),
  ('cb58d110-0000-4000-8000-000000000680', 'cb58d110-0000-4000-8000-000000000670',
   'Explicit unmanaged base', 'explicit-unmanaged-base', 100, 'active', false, false, 0);

-- The schema permits at most one offer per condition across four canonical
-- conditions. Depleted offers do not satisfy managed-stock condition gates.
INSERT INTO public.product_offers
  (id, product_id, merchant_id, condition, price, stock_quantity, status)
SELECT ('cb58d110-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
  'cb58d110-0000-4000-8000-000000000672',
  'cb58d110-0000-4000-8000-000000000670',
  (ARRAY['new', 'open_box', 'refurbished', 'used'])[g], 90, 0, 'active'
FROM pg_catalog.generate_series(1, 4) AS g;

-- The unpublished row is also stocked, but remains unavailable because its
-- merchant is unpublished.
INSERT INTO public.product_offers
  (id, product_id, merchant_id, condition, price, stock_quantity, status)
VALUES
  ('cb58d110-0000-4000-8000-000000000674',
   'cb58d110-0000-4000-8000-000000000673',
   'cb58d110-0000-4000-8000-000000000671', 'used', 90, 5, 'active');

-- Positive control: stocked offer in the first ordered row on a published
-- merchant is selectable.
INSERT INTO public.product_offers
  (id, product_id, merchant_id, condition, price, stock_quantity, status)
VALUES
  ('cb58d110-0000-4000-8000-000000000676',
   'cb58d110-0000-4000-8000-000000000675',
   'cb58d110-0000-4000-8000-000000000670', 'used', 90, 5, 'active');

-- Nullable-managed bare products take the stock-gated offer branch like
-- managed ones: only the stocked twin selects.
INSERT INTO public.product_offers
  (id, product_id, merchant_id, condition, price, stock_quantity, status)
VALUES
  ('cb58d110-0000-4000-8000-000000000681',
   'cb58d110-0000-4000-8000-000000000678',
   'cb58d110-0000-4000-8000-000000000670', 'used', 90, 0, 'active'),
  ('cb58d110-0000-4000-8000-000000000682',
   'cb58d110-0000-4000-8000-000000000679',
   'cb58d110-0000-4000-8000-000000000670', 'used', 90, 5, 'active');

-- A legacy stored child must not create a selectable variant condition when
-- the real product is variantless, even if the caller claims otherwise.
INSERT INTO public.product_variants
  (id, product_id, merchant_id, attributes, stock_quantity, condition)
VALUES
  ('cb58d110-0000-4000-8000-000000000677',
   'cb58d110-0000-4000-8000-000000000672',
   'cb58d110-0000-4000-8000-000000000670', '{"color":"black"}', 5, 'used');

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

DO $$
DECLARE
  fact_ids uuid[];
  browse_ids uuid[];
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'publication regression must run under anon RLS role';
  END IF;
  IF discovery.base_product_option_is_purchasable(
      'cb58d110-0000-4000-8000-000000000678',
      'cb58d110-0000-4000-8000-000000000670') IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'NULL stock management must reject depleted base inventory';
  END IF;
  IF discovery.base_product_option_is_purchasable(
      'cb58d110-0000-4000-8000-000000000679',
      'cb58d110-0000-4000-8000-000000000670') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'NULL stock management must allow stocked base inventory';
  END IF;
  IF discovery.base_product_option_is_purchasable(
      'cb58d110-0000-4000-8000-000000000680',
      'cb58d110-0000-4000-8000-000000000670') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'explicit unmanaged base must remain purchasable without stock';
  END IF;
  IF discovery.product_condition_option_matches(
      'cb58d110-0000-4000-8000-000000000672', true, 'used', 'used', false) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'depleted managed offer must not satisfy public condition matching';
  END IF;
  IF discovery.condition_offer_selectable(
      'cb58d110-0000-4000-8000-000000000672', false, 'used', false) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'offer helper must resolve real managed-stock state instead of caller hints';
  END IF;
  IF discovery.product_condition_option_matches(
      'cb58d110-0000-4000-8000-000000000673', false, 'new', 'used', false) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'caller hints must not expose an unpublished product offer';
  END IF;
  IF discovery.product_condition_option_matches(
      'cb58d110-0000-4000-8000-000000000673', true, 'new', 'used', true) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'caller-supplied variant and stock flags must not expose unpublished offers';
  END IF;
  IF discovery.condition_offer_selectable(
      'cb58d110-0000-4000-8000-000000000673', false, 'used', false) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'offer helper must not expose unpublished merchant offers';
  END IF;
  IF discovery.product_condition_option_matches(
      'cb58d110-0000-4000-8000-000000000675', false, 'new', 'used', true) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'published stocked offer within the first 16 rows must remain selectable';
  END IF;
  IF discovery.condition_offer_selectable(
      'cb58d110-0000-4000-8000-000000000678', false, 'used', NULL) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'NULL stock management must reject a depleted bare offer';
  END IF;
  IF discovery.condition_offer_selectable(
      'cb58d110-0000-4000-8000-000000000679', false, 'used', NULL) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'NULL stock management must allow a stocked bare offer';
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    'cb58d110-0000-4000-8000-000000000670', 'base');
  IF cardinality(fact_ids) IS DISTINCT FROM 2
    OR NOT (fact_ids @> ARRAY[
      'cb58d110-0000-4000-8000-000000000679'::uuid,
      'cb58d110-0000-4000-8000-000000000680'::uuid]) THEN
    RAISE EXCEPTION 'nullable facts must keep stocked and unmanaged bases only, got %', fact_ids;
  END IF;
  SELECT array_agg(id) INTO browse_ids
  FROM public.search_products_browse(
    p_merchant_id => 'cb58d110-0000-4000-8000-000000000670',
    p_condition => 'used', p_limit => 10);
  IF cardinality(browse_ids) IS DISTINCT FROM 2
    OR NOT (browse_ids @> ARRAY[
      'cb58d110-0000-4000-8000-000000000675'::uuid,
      'cb58d110-0000-4000-8000-000000000679'::uuid]) THEN
    RAISE EXCEPTION 'nullable used browse must keep stocked offers only, got %', browse_ids;
  END IF;
END;
$$;

ROLLBACK;

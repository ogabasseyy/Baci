-- Text-match recall (binary64 numerics, JavaScript trim/collapse, effective policy)
-- runs in its own file so neither recall suite exceeds the module line cap.
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

-- Binary64 parity fixtures run under an isolated merchant so the exact
-- row-count assertions above never observe them.
INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000203',
  'binary64-test@example.test',
  'Binary64 Test Merchant',
  'binary64-test-merchant',
  true
);

INSERT INTO public.products
  (id, merchant_id, name, slug, brand, price, status, has_variants, manage_stock, inventory_tracking_policy, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000430', 'cb58d110-0000-4000-8000-000000000203',
   'Binary64 option', 'binary64-option', 'Acme', 50000, 'active', true, true, 'off', '{}'),
  ('cb58d110-0000-4000-8000-000000000433', 'cb58d110-0000-4000-8000-000000000203',
   'Overflow option', 'overflow-option', 'Acme', 50000, 'active', true, true, 'off', '{}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity)
VALUES
  ('cb58d110-0000-4000-8000-000000000431', 'cb58d110-0000-4000-8000-000000000430',
   'cb58d110-0000-4000-8000-000000000203', '{"storage_gb": 256.00000000000001}', 5),
  ('cb58d110-0000-4000-8000-000000000432', 'cb58d110-0000-4000-8000-000000000433',
   'cb58d110-0000-4000-8000-000000000203', '{"storage_gb": 1e999}', 5);

-- JavaScript-trim fixtures run under their own merchant: the loader trims
-- U+FEFF while PostgreSQL [[:space:]] does not, so recall must use the
-- same explicit trim set or it strands the variant before the cap.
INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000207',
  'trim-test@example.test',
  'Trim Test Merchant',
  'trim-test-merchant',
  true
);

INSERT INTO public.products
  (id, merchant_id, name, slug, brand, price, status, has_variants, manage_stock, inventory_tracking_policy, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000440', 'cb58d110-0000-4000-8000-000000000207',
   'Trim option', 'trim-option', 'Acme', 50000, 'active', true, true, 'off', '{}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity)
VALUES
  ('cb58d110-0000-4000-8000-000000000441', 'cb58d110-0000-4000-8000-000000000440',
   'cb58d110-0000-4000-8000-000000000207', ('{"color":"black' || chr(65279) || '"}')::jsonb, 5);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000209',
  'collapse-test@example.test',
  'Collapse Test Merchant',
  'collapse-test-merchant',
  true
);

INSERT INTO public.products
  (id, merchant_id, name, slug, brand, price, status, has_variants, manage_stock, inventory_tracking_policy, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000442', 'cb58d110-0000-4000-8000-000000000209',
   'Collapse option', 'collapse-option', 'Acme', 50000, 'active', true, true, 'off', '{}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity)
VALUES
  ('cb58d110-0000-4000-8000-000000000443', 'cb58d110-0000-4000-8000-000000000442',
   'cb58d110-0000-4000-8000-000000000209', ('{"color":"black' || chr(65279) || 'phone"}')::jsonb, 5);

-- Effective-policy purchasability fixtures: a depleted serialized_strict
-- variant under an unmanaged parent must rank below a purchasable match
-- instead of short-circuiting on the parent flag. The depleted product
-- sorts first by id so the old order would surface it ahead of the match.
INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000208',
  'strict-test@example.test',
  'Strict Test Merchant',
  'strict-test-merchant',
  true
);

INSERT INTO public.products
  (id, merchant_id, name, slug, brand, price, status, has_variants, manage_stock, inventory_tracking_policy, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000450', 'cb58d110-0000-4000-8000-000000000208',
   'Depleted strict', 'depleted-strict', 'Acme', 50000, 'active', true, false, 'off', '{}'),
  ('cb58d110-0000-4000-8000-000000000452', 'cb58d110-0000-4000-8000-000000000208',
   'Available control', 'available-control', 'Acme', 50000, 'active', true, false, 'off', '{}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity, inventory_tracking_policy)
VALUES
  ('cb58d110-0000-4000-8000-000000000451', 'cb58d110-0000-4000-8000-000000000450',
   'cb58d110-0000-4000-8000-000000000208', '{"color":"black"}', 0, 'serialized_strict'),
  ('cb58d110-0000-4000-8000-000000000453', 'cb58d110-0000-4000-8000-000000000452',
   'cb58d110-0000-4000-8000-000000000208', '{"color":"black"}', 0, 'off');

-- Legacy NULL parents count as managed (matching isPublicVariantPurchasable):
-- a depleted effective-off child must sink below a stocked control instead
-- of ranking purchasable. The depleted product sorts first by id so the
-- old order would surface it ahead of the match.
INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000210',
  'legacy-test@example.test',
  'Legacy Test Merchant',
  'legacy-test-merchant',
  true
);

INSERT INTO public.products
  (id, merchant_id, name, slug, brand, price, status, has_variants, manage_stock, inventory_tracking_policy, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000460', 'cb58d110-0000-4000-8000-000000000210',
   'Legacy depleted', 'legacy-depleted', 'Acme', 50000, 'active', true, NULL, 'off', '{}'),
  ('cb58d110-0000-4000-8000-000000000462', 'cb58d110-0000-4000-8000-000000000210',
   'Legacy control', 'legacy-control', 'Acme', 50000, 'active', true, true, 'off', '{}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity)
VALUES
  ('cb58d110-0000-4000-8000-000000000461', 'cb58d110-0000-4000-8000-000000000460',
   'cb58d110-0000-4000-8000-000000000210', '{"color":"black"}', 0),
  ('cb58d110-0000-4000-8000-000000000463', 'cb58d110-0000-4000-8000-000000000462',
   'cb58d110-0000-4000-8000-000000000210', '{"color":"black"}', 2);

-- The numeric parser must accept the JavaScript whitespace the loader does:
-- a BOM-edged unit parses downstream, so NULL here would strand the match.
DO $$
BEGIN
  IF discovery.recall_variant_parse_numeric('storage_gb',
      ('"' || chr(65279) || '512GB"')::jsonb) IS DISTINCT FROM 512 THEN
    RAISE EXCEPTION 'numeric parser rejected JavaScript whitespace the loader accepts';
  END IF;
  IF discovery.recall_variant_parse_numeric('storage_gb', '"512GB"'::jsonb) IS DISTINCT FROM 512 THEN
    RAISE EXCEPTION 'numeric parser control regressed';
  END IF;
END;
$$;


-- Exercise the recall RPC as its public storefront caller, under publication RLS.
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

-- Binary64 recall parity: PostgREST decodes JSON numbers to doubles, so a
-- stored 256.00000000000001 reads as 256 downstream and must recall for an
-- exact 256 intent; past float8 range the loader observes Infinity, which
-- fails equality but satisfies lower-bounded ranges.
DO $$
DECLARE
  recall_ids uuid[];
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'RPC regression must run as the public caller';
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000203',
    '[{"key":"storage_gb","operator":"eq","value":256}]'::jsonb,
    10
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 1
    OR recall_ids[1] IS DISTINCT FROM 'cb58d110-0000-4000-8000-000000000430'::uuid THEN
    RAISE EXCEPTION 'sub-ULP stored numerics must recall for the decoded double, got %', recall_ids;
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000203',
    '[{"key":"storage_gb","operator":"gte","value":256}]'::jsonb,
    10
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 2
    OR NOT (recall_ids @> ARRAY[
      'cb58d110-0000-4000-8000-000000000430'::uuid,
      'cb58d110-0000-4000-8000-000000000433'::uuid
    ]) THEN
    RAISE EXCEPTION 'past-range stored numerics must recall as Infinity for ranges, got %', recall_ids;
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000207',
    '[{"key":"color","operator":"eq","value":"black"}]'::jsonb,
    10
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 1
    OR recall_ids[1] IS DISTINCT FROM 'cb58d110-0000-4000-8000-000000000440'::uuid THEN
    RAISE EXCEPTION 'values with JavaScript-only trim characters must recall trimmed, got %', recall_ids;
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000209',
    '[{"key":"color","operator":"eq","value":"black phone"}]'::jsonb,
    10
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 1
    OR recall_ids[1] IS DISTINCT FROM 'cb58d110-0000-4000-8000-000000000442'::uuid THEN
    RAISE EXCEPTION 'values with interior JavaScript whitespace must recall collapsed, got %', recall_ids;
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000208',
    '[{"key":"color","operator":"eq","value":"black"}]'::jsonb,
    10
  );
  IF recall_ids IS DISTINCT FROM ARRAY[
    'cb58d110-0000-4000-8000-000000000452'::uuid,
    'cb58d110-0000-4000-8000-000000000450'::uuid
  ] THEN
    RAISE EXCEPTION 'depleted strict variants must rank below purchasable matches, got %', recall_ids;
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000210',
    '[{"key":"color","operator":"eq","value":"black"}]'::jsonb,
    10
  );
  IF recall_ids IS DISTINCT FROM ARRAY[
    'cb58d110-0000-4000-8000-000000000462'::uuid,
    'cb58d110-0000-4000-8000-000000000460'::uuid
  ] THEN
    RAISE EXCEPTION 'depleted variants under legacy NULL parents must rank below purchasable matches, got %', recall_ids;
  END IF;
END;
$$;
ROLLBACK;

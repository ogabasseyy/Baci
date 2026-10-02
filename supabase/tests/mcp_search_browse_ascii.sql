-- Unconstrained browse narrows brand/category with the same ASCII-only
-- substring comparison as the post-hydration filter before the window cap,
-- so locale-folded rows cannot strand genuine matches past the cap.
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES
  ('e5100000-0000-4000-8000-000000000601', 'browse-ascii@example.test',
   'Browse ASCII Merchant', 'browse-ascii-merchant', true),
  ('e5100000-0000-4000-8000-000000000602', 'browse-hidden@example.test',
   'Browse Hidden Merchant', 'browse-hidden-merchant', false),
  ('e5100000-0000-4000-8000-000000000603', 'browse-exclusion@example.test',
   'Browse Exclusion Merchant', 'browse-exclusion-merchant', true);

INSERT INTO public.products
  (id, merchant_id, name, slug, brand, category, price, status, created_at, discovery_metadata)
VALUES
  ('e5100000-0000-4000-8000-000000000611', 'e5100000-0000-4000-8000-000000000601',
   'Sigma brand', 'sigma-brand', 'ΟΣ', 'Audio', 50000, 'active', '2024-01-01T00:00:00Z', '{}'),
  ('e5100000-0000-4000-8000-000000000612', 'e5100000-0000-4000-8000-000000000601',
   'Lowercase sigma brand', 'lowercase-sigma-brand', 'MyοσBrand', 'Audio', 50000, 'active', '2024-01-01T00:00:00Z', '{}'),
  ('e5100000-0000-4000-8000-000000000613', 'e5100000-0000-4000-8000-000000000601',
   'Sigma category', 'sigma-category', 'Plain', 'ΟΣ', 50000, 'active', '2024-01-01T00:00:00Z', '{}'),
  ('e5100000-0000-4000-8000-000000000614', 'e5100000-0000-4000-8000-000000000601',
   'Newest Acme', 'newest-acme', 'Acme', 'Audio', 50000, 'active', '2025-06-01T00:00:00Z', '{}'),
  ('e5100000-0000-4000-8000-000000000615', 'e5100000-0000-4000-8000-000000000602',
   'Unpublished Acme', 'unpublished-acme', 'Acme', 'Audio', 50000, 'active', '2024-01-01T00:00:00Z', '{}'),
  ('e5100000-0000-4000-8000-000000000616', 'e5100000-0000-4000-8000-000000000601',
   'Draft Acme', 'draft-acme', 'Acme', 'Audio', 50000, 'draft', '2024-01-01T00:00:00Z', '{}');

INSERT INTO public.products
  (id, merchant_id, name, slug, brand, category, price, status, created_at, condition, discovery_metadata)
VALUES
  ('e5100000-0000-4000-8000-000000000617', 'e5100000-0000-4000-8000-000000000601',
   'Used base', 'used-base', 'UsedGoods', 'Audio', 50000, 'active', '2024-01-01T00:00:00Z', 'used', '{}'),
  ('e5100000-0000-4000-8000-000000000618', 'e5100000-0000-4000-8000-000000000601',
   'Undated Zed', 'undated-zed', 'Zed', 'Audio', 50000, 'active', NULL, 'new', '{}');

-- A used parent whose variants are all explicitly new: the base never
-- sells on a variant product, so a used browse must not admit it.
INSERT INTO public.products
  (id, merchant_id, name, slug, brand, category, price, status, created_at, condition, has_variants, discovery_metadata)
VALUES
  ('e5100000-0000-4000-8000-000000000619', 'e5100000-0000-4000-8000-000000000601',
   'Used parent new variants', 'used-parent-new-variants', 'UsedGoods', 'Audio', 50000, 'active', NULL, 'used', true, '{}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity, condition)
VALUES
  ('e5100000-0000-4000-8000-000000000631', 'e5100000-0000-4000-8000-000000000619',
   'e5100000-0000-4000-8000-000000000601', '{"storage_gb":128}', 5, 'new'),
  ('e5100000-0000-4000-8000-000000000632', 'e5100000-0000-4000-8000-000000000619',
   'e5100000-0000-4000-8000-000000000601', '{"storage_gb":256}', 5, 'new');

-- A depleted managed base and an oversized parent filter before paging;
-- the unmanaged twin stays servable without stock.
INSERT INTO public.products
  (id, merchant_id, name, slug, brand, category, price, status, created_at, condition, has_variants, manage_stock, stock_quantity, discovery_metadata)
VALUES
  ('e5100000-0000-4000-8000-000000000624', 'e5100000-0000-4000-8000-000000000601',
   'Depleted base', 'depleted-base', 'Depl', 'Audio', 50000, 'active', NULL, 'new', false, true, 0, '{}'),
  ('e5100000-0000-4000-8000-000000000625', 'e5100000-0000-4000-8000-000000000601',
   'Oversized browse', 'oversized-browse', 'Over', 'Audio', 50000, 'active', NULL, 'new', true, true, 5, '{}'),
  ('e5100000-0000-4000-8000-000000000626', 'e5100000-0000-4000-8000-000000000601',
   'Unmanaged base', 'unmanaged-base', 'Unmg', 'Audio', 50000, 'active', NULL, 'new', false, false, 0, '{}'),
  ('e5100000-0000-4000-8000-000000000627', 'e5100000-0000-4000-8000-000000000601',
   'Depleted new base with used offer', 'depleted-new-base-used-offer', 'Depl', 'Audio', 50000, 'active', NULL, 'new', false, true, 0, '{}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity, condition)
VALUES
  ('e5100000-0000-4000-8000-000000000628', 'e5100000-0000-4000-8000-000000000627',
   'e5100000-0000-4000-8000-000000000601', '{"color":"black"}', 0, 'used');

INSERT INTO public.product_offers (id, product_id, merchant_id, condition, price, stock_quantity, status)
VALUES
  ('e5100000-0000-4000-8000-000000000729', 'e5100000-0000-4000-8000-000000000627',
   'e5100000-0000-4000-8000-000000000601', 'used', 40000, 2, 'active');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity, condition)
SELECT ('e5100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
  'e5100000-0000-4000-8000-000000000625',
  'e5100000-0000-4000-8000-000000000601',
  jsonb_build_object('storage_gb', 256, 'slot', g), 5, 'new'
FROM pg_catalog.generate_series(1, 129) AS g;

-- Exclusion fixtures live on their own merchant: a phone, a tablet, and a
-- type-less row that must stay reachable (unverified, never excluded).
INSERT INTO public.products
  (id, merchant_id, name, slug, brand, category, price, status, created_at, discovery_metadata)
VALUES
  ('e5100000-0000-4000-8000-000000000620', 'e5100000-0000-4000-8000-000000000603',
   'Exclusion phone', 'exclusion-phone', 'Excl', 'Audio', 50000, 'active', '2024-01-01T00:00:00Z', '{"product_type":"phone"}'),
  ('e5100000-0000-4000-8000-000000000621', 'e5100000-0000-4000-8000-000000000603',
   'Exclusion tablet', 'exclusion-tablet', 'Excl', 'Audio', 50000, 'active', '2024-01-01T00:00:00Z', '{"product_type":"tablet"}'),
  ('e5100000-0000-4000-8000-000000000622', 'e5100000-0000-4000-8000-000000000603',
   'Exclusion typeless', 'exclusion-typeless', 'Excl', 'Audio', 50000, 'active', '2024-01-01T00:00:00Z', '{}'),
  ('e5100000-0000-4000-8000-000000000623', 'e5100000-0000-4000-8000-000000000603',
   'Windowed offers', 'windowed-offers', 'Excl', 'Audio', 50000, 'active', '2024-01-01T00:00:00Z', '{"product_type":"phone"}');

-- One live offer per condition fills the hydrated window in (condition,
-- id) order with the used match last: UNIQUE(product_id, condition) plus
-- the four-value condition check cap rows at four, so the 16-row window
-- cannot truncate and the last-row match must resolve.
INSERT INTO public.product_offers (id, product_id, merchant_id, condition, price, stock_quantity, status)
VALUES
  (('e5100000-0000-4000-8000-' || lpad(to_hex(701), 12, '0'))::uuid,
   'e5100000-0000-4000-8000-000000000623',
   'e5100000-0000-4000-8000-000000000603', 'new', 40000, 2, 'active'),
  (('e5100000-0000-4000-8000-' || lpad(to_hex(702), 12, '0'))::uuid,
   'e5100000-0000-4000-8000-000000000623',
   'e5100000-0000-4000-8000-000000000603', 'open_box', 40000, 2, 'active'),
  (('e5100000-0000-4000-8000-' || lpad(to_hex(703), 12, '0'))::uuid,
   'e5100000-0000-4000-8000-000000000623',
   'e5100000-0000-4000-8000-000000000603', 'refurbished', 40000, 2, 'active'),
  (('e5100000-0000-4000-8000-' || lpad(to_hex(717), 12, '0'))::uuid,
   'e5100000-0000-4000-8000-000000000623',
   'e5100000-0000-4000-8000-000000000603', 'used', 40000, 2, 'active');

-- Availability fixtures carry stock except the depleted pins and the
-- rows deliberately carrying zero stock.
UPDATE public.products SET stock_quantity = 5
WHERE id NOT IN (
  'e5100000-0000-4000-8000-000000000624',
  'e5100000-0000-4000-8000-000000000626',
  'e5100000-0000-4000-8000-000000000627'
);

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

DO $$
DECLARE
  browse_ids uuid[];
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'RPC regression must run as the public caller';
  END IF;
  -- A lowercase-sigma filter must not match the uppercase-sigma brand: the
  -- locale-folding predicate would admit it while the ASCII post-hydration
  -- filter rejects it, filling the window with a stranded row.
  SELECT array_agg(id) INTO browse_ids
  FROM public.search_products_browse(
    p_merchant_id => 'e5100000-0000-4000-8000-000000000601',
    p_brand => 'οσ',
    p_limit => 10
  );
  IF cardinality(browse_ids) IS DISTINCT FROM 1
    OR browse_ids[1] IS DISTINCT FROM 'e5100000-0000-4000-8000-000000000612'::uuid THEN
    RAISE EXCEPTION 'ASCII brand narrowing must skip the folded sigma row, got %', browse_ids;
  END IF;
  -- Exact non-ASCII spellings still match: nothing is folded away.
  SELECT array_agg(id) INTO browse_ids
  FROM public.search_products_browse(
    p_merchant_id => 'e5100000-0000-4000-8000-000000000601',
    p_brand => 'ΟΣ',
    p_limit => 10
  );
  IF cardinality(browse_ids) IS DISTINCT FROM 1
    OR browse_ids[1] IS DISTINCT FROM 'e5100000-0000-4000-8000-000000000611'::uuid THEN
    RAISE EXCEPTION 'exact sigma brand must stay reachable, got %', browse_ids;
  END IF;
  SELECT array_agg(id) INTO browse_ids
  FROM public.search_products_browse(
    p_merchant_id => 'e5100000-0000-4000-8000-000000000601',
    p_category => 'ΟΣ',
    p_limit => 10
  );
  IF cardinality(browse_ids) IS DISTINCT FROM 1
    OR browse_ids[1] IS DISTINCT FROM 'e5100000-0000-4000-8000-000000000613'::uuid THEN
    RAISE EXCEPTION 'exact sigma category must stay reachable, got %', browse_ids;
  END IF;
  -- Newest orders server-side before the cap, with null creation dates
  -- last like the downstream comparator; unpublished and draft rows never
  -- surface through the SECURITY DEFINER boundary.
  SELECT array_agg(id) INTO browse_ids
  FROM public.search_products_browse(
    p_merchant_id => 'e5100000-0000-4000-8000-000000000601',
    p_sort => 'newest',
    p_limit => 10
  );
  IF cardinality(browse_ids) IS DISTINCT FROM 9
    OR browse_ids[1] IS DISTINCT FROM 'e5100000-0000-4000-8000-000000000614'::uuid
    OR browse_ids[6] IS DISTINCT FROM 'e5100000-0000-4000-8000-000000000618'::uuid
    OR browse_ids[7] IS DISTINCT FROM 'e5100000-0000-4000-8000-000000000619'::uuid
    OR browse_ids[8] IS DISTINCT FROM 'e5100000-0000-4000-8000-000000000626'::uuid
    OR browse_ids @> ARRAY['e5100000-0000-4000-8000-000000000624'::uuid]
    OR browse_ids @> ARRAY['e5100000-0000-4000-8000-000000000625'::uuid] THEN
    RAISE EXCEPTION 'newest browse must lead with the 2025 row and park undated rows last, got %', browse_ids;
  END IF;
  -- Requested conditions narrow before paging: the used base and the
  -- depleted new base with a stocked used offer survive a used request,
  -- and both drop out of a new request.
  SELECT array_agg(id) INTO browse_ids
  FROM public.search_products_browse(
    p_merchant_id => 'e5100000-0000-4000-8000-000000000601',
    p_condition => 'used',
    p_limit => 10
  );
  IF cardinality(browse_ids) IS DISTINCT FROM 2
    OR browse_ids[1] IS DISTINCT FROM 'e5100000-0000-4000-8000-000000000617'::uuid
    OR browse_ids[2] IS DISTINCT FROM 'e5100000-0000-4000-8000-000000000627'::uuid THEN
    RAISE EXCEPTION 'used browse must keep the used base and used offer only, got %', browse_ids;
  END IF;
  SELECT array_agg(id) INTO browse_ids
  FROM public.search_products_browse(
    p_merchant_id => 'e5100000-0000-4000-8000-000000000601',
    p_condition => 'new',
    p_limit => 10
  );
  IF cardinality(browse_ids) IS DISTINCT FROM 7
    OR browse_ids @> ARRAY['e5100000-0000-4000-8000-000000000617'::uuid]
    OR browse_ids @> ARRAY['e5100000-0000-4000-8000-000000000627'::uuid]
    OR browse_ids @> ARRAY['e5100000-0000-4000-8000-000000000624'::uuid]
    OR browse_ids @> ARRAY['e5100000-0000-4000-8000-000000000625'::uuid] THEN
    RAISE EXCEPTION 'new browse must drop the used base, got %', browse_ids;
  END IF;
  SELECT array_agg(id) INTO browse_ids
  FROM public.search_products_browse(
    p_merchant_id => 'e5100000-0000-4000-8000-000000000601',
    p_brand => 'Acme',
    p_limit => 10
  );
  IF cardinality(browse_ids) IS DISTINCT FROM 1
    OR browse_ids[1] IS DISTINCT FROM 'e5100000-0000-4000-8000-000000000614'::uuid THEN
    RAISE EXCEPTION 'browse must hide unpublished and draft rows, got %', browse_ids;
  END IF;
  SELECT array_agg(id) INTO browse_ids
  FROM public.search_products_browse(
    p_merchant_id => 'e5100000-0000-4000-8000-000000000601',
    p_limit => 2,
    p_offset => 2
  );
  IF cardinality(browse_ids) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'browse paging must honor limit and offset, got %', browse_ids;
  END IF;
  -- Scalar filters beyond the public schema limits reject before the query.
  BEGIN
    PERFORM * FROM public.search_products_browse(
      p_merchant_id => 'e5100000-0000-4000-8000-000000000601',
      p_brand => repeat('b', 51));
    RAISE EXCEPTION 'over-long brand filters must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.search_products_browse(
      p_merchant_id => 'e5100000-0000-4000-8000-000000000601',
      p_category => repeat('c', 51));
    RAISE EXCEPTION 'over-long category filters must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.search_products_browse(
      p_merchant_id => 'e5100000-0000-4000-8000-000000000601',
      p_condition => repeat('n', 51));
    RAISE EXCEPTION 'over-long condition filters must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  -- Intent-level excluded types filter before paging; the type-less row
  -- stays reachable and the unexcluded browse keeps all three.
  SELECT array_agg(id) INTO browse_ids
  FROM public.search_products_browse(
    p_merchant_id => 'e5100000-0000-4000-8000-000000000603',
    p_excluded_types => '["phone"]'::jsonb,
    p_limit => 10
  );
  IF cardinality(browse_ids) IS DISTINCT FROM 1
    OR browse_ids[1] IS DISTINCT FROM 'e5100000-0000-4000-8000-000000000621'::uuid THEN
    RAISE EXCEPTION 'excluded browse must keep the tablet only, got %', browse_ids;
  END IF;
  SELECT array_agg(id) INTO browse_ids
  FROM public.search_products_browse(
    p_merchant_id => 'e5100000-0000-4000-8000-000000000603',
    p_limit => 10
  );
  IF cardinality(browse_ids) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'unexcluded browse must keep all four rows, got %', browse_ids;
  END IF;
  -- A full-house window resolves its last-row match: the used offer
  -- lands fourth in (condition, id) order and stays resolvable.
  SELECT array_agg(id) INTO browse_ids
  FROM public.search_products_browse(
    p_merchant_id => 'e5100000-0000-4000-8000-000000000603',
    p_condition => 'used',
    p_limit => 10
  );
  IF cardinality(browse_ids) IS DISTINCT FROM 1
    OR browse_ids[1] IS DISTINCT FROM 'e5100000-0000-4000-8000-000000000623'::uuid THEN
    RAISE EXCEPTION 'full-house used browse must resolve the last-row match, got %', browse_ids;
  END IF;
  BEGIN
    PERFORM * FROM public.search_products_browse(
      p_merchant_id => 'e5100000-0000-4000-8000-000000000603',
      p_excluded_types => (SELECT pg_catalog.jsonb_agg('phone'::text)
        FROM pg_catalog.generate_series(1, 11)));
    RAISE EXCEPTION 'over-count excluded types must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END;
$$;

ROLLBACK;

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
   'Browse Hidden Merchant', 'browse-hidden-merchant', false);

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
  IF cardinality(browse_ids) IS DISTINCT FROM 6
    OR browse_ids[1] IS DISTINCT FROM 'e5100000-0000-4000-8000-000000000614'::uuid
    OR browse_ids[6] IS DISTINCT FROM 'e5100000-0000-4000-8000-000000000618'::uuid THEN
    RAISE EXCEPTION 'newest browse must lead with the 2025 row and park undated rows last, got %', browse_ids;
  END IF;
  -- Requested conditions narrow before paging: only the used base
  -- survives a used request, and it drops out of a new request.
  SELECT array_agg(id) INTO browse_ids
  FROM public.search_products_browse(
    p_merchant_id => 'e5100000-0000-4000-8000-000000000601',
    p_condition => 'used',
    p_limit => 10
  );
  IF cardinality(browse_ids) IS DISTINCT FROM 1
    OR browse_ids[1] IS DISTINCT FROM 'e5100000-0000-4000-8000-000000000617'::uuid THEN
    RAISE EXCEPTION 'used browse must keep the used base only, got %', browse_ids;
  END IF;
  SELECT array_agg(id) INTO browse_ids
  FROM public.search_products_browse(
    p_merchant_id => 'e5100000-0000-4000-8000-000000000601',
    p_condition => 'new',
    p_limit => 10
  );
  IF cardinality(browse_ids) IS DISTINCT FROM 5
    OR browse_ids @> ARRAY['e5100000-0000-4000-8000-000000000617'::uuid] THEN
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
END;
$$;

ROLLBACK;

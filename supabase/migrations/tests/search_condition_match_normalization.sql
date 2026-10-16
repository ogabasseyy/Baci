-- Condition alias folding in refined search (20261008370000 line 78,
-- 20261016090000 normalizer): the filter compares the canonicalized
-- option condition so hyphen/whitespace/case variants and the
-- uk_used/refurbished aliases match their canonical filter, exactly like
-- the PDP and the shared TypeScript normalizer.
DO $$
BEGIN
  IF storefront_search_private.normalize_condition_for_match('open-box')
    IS DISTINCT FROM 'open_box' THEN
    RAISE EXCEPTION 'hyphenated open-box must canonicalize to open_box';
  END IF;
  IF storefront_search_private.normalize_condition_for_match('open box')
    IS DISTINCT FROM 'open_box' THEN
    RAISE EXCEPTION 'whitespace open box must canonicalize to open_box';
  END IF;
  IF storefront_search_private.normalize_condition_for_match('Open_Box')
    IS DISTINCT FROM 'open_box' THEN
    RAISE EXCEPTION 'cased Open_Box must canonicalize to open_box';
  END IF;
  IF storefront_search_private.normalize_condition_for_match('uk_used')
    IS DISTINCT FROM 'used' THEN
    RAISE EXCEPTION 'uk_used must fold to used';
  END IF;
  IF storefront_search_private.normalize_condition_for_match('refurbished')
    IS DISTINCT FROM 'open_box' THEN
    RAISE EXCEPTION 'refurbished must fold to open_box';
  END IF;
  IF storefront_search_private.normalize_condition_for_match('new')
    IS DISTINCT FROM 'new' THEN
    RAISE EXCEPTION 'canonical new must pass through';
  END IF;
  IF storefront_search_private.normalize_condition_for_match('bogus')
    IS NOT NULL THEN
    RAISE EXCEPTION 'unknown conditions must canonicalize to NULL';
  END IF;
  IF storefront_search_private.normalize_condition_for_match(NULL)
    IS NOT NULL THEN
    RAISE EXCEPTION 'NULL condition must canonicalize to NULL';
  END IF;
END $$;

-- Integration: a storable alias (refurbished offer) matches the canonical
-- open_box refinement, and a disjoint filter excludes it. (Hyphenated
-- spellings are rejected by the column CHECKs, so the alias row is the
-- closest reachable integration case; the unit block above pins the
-- hyphen behavior itself.)
ALTER TABLE public.merchants DISABLE TRIGGER USER;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('02e50000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'cond-fold-owner@example.com', 'test',
  now(), now(), now(), '{}', '{}');
INSERT INTO public.merchants (id, user_id, email, business_name, slug, is_published)
VALUES ('02e50000-0000-4000-8000-000000000001', '02e50000-0000-4000-8000-000000000002',
  'cond-fold-pub@example.com', 'Cond Fold Pub', 'cond-fold-pub', true);
ALTER TABLE public.merchants ENABLE TRIGGER USER;

ALTER TABLE public.products DISABLE TRIGGER USER;
-- Search text columns are GENERATED from name/brand/category/sku.
INSERT INTO public.products (id, merchant_id, name, price, condition, status,
  manage_stock, has_condition_offers, has_variants)
VALUES ('02e50000-0000-4000-8000-000000000011', '02e50000-0000-4000-8000-000000000001',
  'Foldable Widget', 50000, 'new', 'active',
  false, true, false);
ALTER TABLE public.products ENABLE TRIGGER USER;

INSERT INTO public.product_offers (id, product_id, merchant_id, condition, price,
  stock_quantity, status)
VALUES ('02e50000-0000-4000-8000-000000000021', '02e50000-0000-4000-8000-000000000011',
  '02e50000-0000-4000-8000-000000000001', 'refurbished', 30000, 5, 'active');

DO $$
DECLARE
  n bigint;
  v_offer uuid;
BEGIN
  SELECT count(*), max(matched_offer_id) INTO n, v_offer
  FROM public.search_storefront_products_refined(
    'foldable widget', '02e50000-0000-4000-8000-000000000001',
    NULL, NULL, 'open_box'
  );
  IF n <> 1 THEN
    RAISE EXCEPTION 'refurbished offer must match the open_box filter, got %', n;
  END IF;
  IF v_offer IS DISTINCT FROM '02e50000-0000-4000-8000-000000000021' THEN
    RAISE EXCEPTION 'matched offer id wrong: %', v_offer;
  END IF;

  SELECT count(*) INTO n
  FROM public.search_storefront_products_refined(
    'foldable widget', '02e50000-0000-4000-8000-000000000001',
    NULL, NULL, 'used'
  );
  IF n <> 0 THEN
    RAISE EXCEPTION 'refurbished offer must not match the used filter, got %', n;
  END IF;
END $$;

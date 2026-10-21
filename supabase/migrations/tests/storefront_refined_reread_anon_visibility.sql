-- =============================================
-- BEHAVIORAL TEST: the refined-search re-read shape works for anon and
-- the merchant visibility RPC resolves published/unpublished/admin.
--   The app re-reads matched products as anon/authenticated and checks
--   visibility through public.storefront_search_merchant_is_visible
--   (SECURITY DEFINER): merchants.is_platform_admin is revoked from
--   anon, so embedding it would 42501 the whole re-read. Pin the
--   working shape here — re-read rows readable, RPC bits correct, and
--   a direct is_platform_admin select still denied (the reason the RPC
--   exists; guards against an embed regression).
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/storefront_refined_reread_anon_visibility.sql
-- =============================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_pub uuid := '0be30000-0000-4000-8000-000000000001';
  v_unpub uuid := '0be30000-0000-4000-8000-000000000002';
  v_admin uuid := '0be30000-0000-4000-8000-000000000003';
  v_product uuid := '0be30000-0000-4000-8000-000000000011';
  v_visible boolean;
  v_rows int;
  v_denied boolean := false;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug, is_published, is_platform_admin)
  VALUES (v_pub, 'reread-pub@example.com', 'Reread Pub', 'reread-pub', true, false),
    (v_unpub, 'reread-unpub@example.com', 'Reread Unpub', 'reread-unpub', false, false),
    (v_admin, 'reread-admin@example.com', 'Reread Admin', 'reread-admin', false, true);

  INSERT INTO public.products (id, merchant_id, name, price, status,
    stock_quantity, manage_stock, has_condition_offers, has_variants)
  VALUES (v_product, v_pub, 'Reread phone', 500000,
    'active', 5, false, false, false);

  -- Visibility RPC resolves all three merchant kinds for anon.
  SET LOCAL ROLE anon;
  SELECT public.storefront_search_merchant_is_visible(v_pub) INTO v_visible;
  IF v_visible IS NOT TRUE THEN
    RAISE EXCEPTION 'expected published merchant visible to anon';
  END IF;
  SELECT public.storefront_search_merchant_is_visible(v_unpub) INTO v_visible;
  IF v_visible IS NOT FALSE THEN
    RAISE EXCEPTION 'expected unpublished merchant invisible to anon';
  END IF;
  SELECT public.storefront_search_merchant_is_visible(v_admin) INTO v_visible;
  IF v_visible IS NOT TRUE THEN
    RAISE EXCEPTION 'expected platform-admin merchant visible to anon';
  END IF;

  -- The re-read query shape (products by merchant + active + id set)
  -- succeeds for anon: no revoked column, no 42501.
  SELECT count(*) INTO v_rows
  FROM public.products
  WHERE merchant_id = v_pub AND status = 'active' AND id IN (v_product);
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'expected anon re-read to return 1 row, got %', v_rows;
  END IF;

  -- The revoked column itself stays denied: this is why the re-read
  -- must not embed is_platform_admin.
  BEGIN
    PERFORM 1 FROM public.merchants WHERE id = v_pub AND is_platform_admin IS TRUE;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'expected is_platform_admin select to stay revoked from anon';
  END IF;
  RESET ROLE;
END;
$$;

ROLLBACK;

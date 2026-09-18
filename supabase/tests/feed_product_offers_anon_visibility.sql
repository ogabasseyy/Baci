-- =============================================
-- VERIFICATION: public feed offer visibility (PR #3461)
--   Anonymous feed readers must see active offers of active products
--   and nothing else on public.product_offers.
--
-- USAGE:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/feed_product_offers_anon_visibility.sql
-- =============================================

BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := 'b2000000-0000-4000-8000-000000000001';
  v_active_product uuid := 'b2000000-0000-4000-8000-000000000002';
  v_draft_product uuid := 'b2000000-0000-4000-8000-000000000003';
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (v_merchant, 'feed-offers@example.com', 'Feed Offers Store', 'feed-offers-store');

  INSERT INTO public.products (id, merchant_id, name, price, status)
  VALUES
    (v_active_product, v_merchant, 'Active Phone', 100, 'active'),
    (v_draft_product, v_merchant, 'Draft Phone', 100, 'draft');

  INSERT INTO public.product_offers
    (id, product_id, merchant_id, condition, price, stock_quantity, status)
  VALUES
    ('b2000000-0000-4000-8000-000000000011', v_active_product, v_merchant, 'new', 100, 5, 'active'),
    ('b2000000-0000-4000-8000-000000000012', v_active_product, v_merchant, 'used', 80, 0, 'inactive'),
    ('b2000000-0000-4000-8000-000000000013', v_draft_product, v_merchant, 'new', 100, 5, 'active');

  -- Cross-tenant attack row: another merchant's offer planted on our active
  -- product. The service role bypasses RLS for seeding; readers must not
  -- see it.
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES ('b2000000-0000-4000-8000-000000000099', 'attacker@example.com', 'Attacker Store', 'attacker-store');
  INSERT INTO public.product_offers
    (id, product_id, merchant_id, condition, price, stock_quantity, status)
  VALUES
    ('b2000000-0000-4000-8000-000000000014', v_active_product, 'b2000000-0000-4000-8000-000000000099', 'new', 1, 5, 'active');
END;
$$;

-- ---------------------------------------------------------------------------
-- Anonymous feed reader assertions.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);

DO $$
DECLARE
  v_visible int;
BEGIN
  SELECT count(*) INTO v_visible FROM public.product_offers;
  IF v_visible <> 1 THEN
    RAISE EXCEPTION
      'anonymous feed read saw % offer rows; expected exactly the active offer of the active product',
      v_visible;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.product_offers
    WHERE id = 'b2000000-0000-4000-8000-000000000011'
      AND condition = 'new'
  ) THEN
    RAISE EXCEPTION 'anonymous feed read missed the active offer of the active product';
  END IF;
END;
$$;

RESET ROLE;

ROLLBACK;

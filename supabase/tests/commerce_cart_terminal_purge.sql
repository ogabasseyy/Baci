-- Final-chain assertions for commerce_cart_terminal_purge: terminal
-- carts older than the retention window are reclaimed with their
-- dependent rows; live and recently-terminal carts survive, and bound
-- order rows are never cart-owned. Runs after
-- commerce_cart_checkout_add_identity on the same disposable catalog.
DO $$
DECLARE
  m uuid := '11111111-1111-4111-8111-111111111111';
  p uuid := '44444444-4444-4444-8444-444444444444';
  old_terminal uuid := 'aaaaaaaa-4600-4000-8000-000000000001';
  old_grant uuid := 'bbbbbbbb-4600-4000-8000-000000000001';
  recent_terminal uuid := 'aaaaaaaa-4600-4000-8000-000000000002';
  live uuid := 'aaaaaaaa-4600-4000-8000-000000000003';
  purged integer;
BEGIN
  -- Old expired cart with line + grant dependents.
  INSERT INTO public.commerce_carts(id, merchant_id, state, created_at, updated_at, expires_at)
  VALUES (old_terminal, m, 'expired', now() - interval '200 days', now() - interval '120 days', now() - interval '118 days');
  INSERT INTO public.commerce_cart_grants(id, merchant_id, cart_id, principal_id, expires_at)
  VALUES (old_grant, m, old_terminal, 'purge-fixture', now() - interval '118 days');
  INSERT INTO public.commerce_cart_lines(merchant_id, cart_id, product_id, quantity, last_unit_price_minor)
  VALUES (m, old_terminal, p, 1, 1500);
  -- Recently completed cart and an old but still-active cart survive.
  INSERT INTO public.commerce_carts(id, merchant_id, state, created_at, updated_at, expires_at)
  VALUES (recent_terminal, m, 'completed', now() - interval '40 days', now() - interval '10 days', now() + interval '1 day');
  INSERT INTO public.commerce_carts(id, merchant_id, state, created_at, updated_at, expires_at)
  VALUES (live, m, 'active', now() - interval '200 days', now() - interval '120 days', now() + interval '1 day');

  purged := public.commerce_cart_purge_terminal_carts(interval '90 days', 100);
  IF purged <> 1 THEN
    RAISE EXCEPTION 'purge must delete exactly the old terminal cart, deleted %', purged;
  END IF;
  IF EXISTS (SELECT 1 FROM public.commerce_carts WHERE id = old_terminal) THEN
    RAISE EXCEPTION 'old terminal cart must be purged';
  END IF;
  IF EXISTS (SELECT 1 FROM public.commerce_cart_lines WHERE cart_id = old_terminal) THEN
    RAISE EXCEPTION 'purged cart lines must cascade away';
  END IF;
  IF EXISTS (SELECT 1 FROM public.commerce_cart_grants WHERE cart_id = old_terminal) THEN
    RAISE EXCEPTION 'purged cart grants must cascade away';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.commerce_carts WHERE id = recent_terminal) THEN
    RAISE EXCEPTION 'recently terminal cart must survive the retention window';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.commerce_carts WHERE id = live) THEN
    RAISE EXCEPTION 'active cart must never be purged';
  END IF;
  -- A second run has nothing left to do.
  purged := public.commerce_cart_purge_terminal_carts(interval '90 days', 100);
  IF purged <> 0 THEN
    RAISE EXCEPTION 'purge must be idempotent, deleted % more', purged;
  END IF;
END $$;

-- Retention floor and batch bounds are enforced.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.commerce_cart_purge_terminal_carts(interval '1 day', 10);
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'purge must reject retention windows below the floor';
  END IF;
END $$;

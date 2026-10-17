-- Shared server cart: dedicated roles, narrow grants, RLS policies and
-- bounded cleanup. Shopper claims (cart_merchant_id, cart_id,
-- cart_grant_id, cart_principal_id, cart_scope) are minted server-side by
-- createCartScopedClient; every policy rechecks them, including grant
-- liveness, on each statement. No grants to anon, authenticated or PUBLIC.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_cart_shopper') THEN
    CREATE ROLE commerce_cart_shopper NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_cart_receiver') THEN
    CREATE ROLE commerce_cart_receiver NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_cart_worker') THEN
    CREATE ROLE commerce_cart_worker NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO commerce_cart_shopper, commerce_cart_receiver, commerce_cart_worker;

-- Least-privilege table grants. Shopper writes only bootstrap creation;
-- all other mutations go through Task 3 transaction RPCs. The receiver
-- gets no table access at all; Task 8 grants it only its private topic.
GRANT SELECT, INSERT ON public.commerce_carts TO commerce_cart_shopper;
GRANT SELECT ON public.commerce_cart_lines TO commerce_cart_shopper;
GRANT SELECT ON public.commerce_cart_grants TO commerce_cart_shopper;
GRANT SELECT, INSERT ON public.commerce_cart_creation_requests TO commerce_cart_shopper;
GRANT SELECT, UPDATE ON public.commerce_cart_events TO commerce_cart_worker;

-- Own live grant: the shopper reads its own grant row; cart/line policies
-- additionally require the grant to be unexpired and unrevoked.
DROP POLICY IF EXISTS commerce_cart_grants_shopper_select ON public.commerce_cart_grants;
CREATE POLICY commerce_cart_grants_shopper_select
  ON public.commerce_cart_grants
  FOR SELECT
  TO commerce_cart_shopper
  USING (
    merchant_id = nullif((select auth.jwt() ->> 'cart_merchant_id'), '')::uuid
    AND id = nullif((select auth.jwt() ->> 'cart_grant_id'), '')::uuid
    AND principal_id = (select auth.jwt() ->> 'cart_principal_id')
  );

-- Own cart, only while the presented grant is live for this cart.
DROP POLICY IF EXISTS commerce_carts_shopper_select ON public.commerce_carts;
CREATE POLICY commerce_carts_shopper_select
  ON public.commerce_carts
  FOR SELECT
  TO commerce_cart_shopper
  USING (
    merchant_id = nullif((select auth.jwt() ->> 'cart_merchant_id'), '')::uuid
    AND id = nullif((select auth.jwt() ->> 'cart_id'), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM public.commerce_cart_grants g
      WHERE g.id = nullif((select auth.jwt() ->> 'cart_grant_id'), '')::uuid
        AND g.cart_id = public.commerce_carts.id
        AND g.merchant_id = public.commerce_carts.merchant_id
        AND g.principal_id = (select auth.jwt() ->> 'cart_principal_id')
        AND g.expires_at > now()
        AND g.revoked_at IS NULL
    )
  );

-- Bootstrap creation: a pre-cart proof may insert a cart under its own
-- merchant only. Session proofs carry a cart claim and are excluded.
DROP POLICY IF EXISTS commerce_carts_shopper_bootstrap_insert ON public.commerce_carts;
CREATE POLICY commerce_carts_shopper_bootstrap_insert
  ON public.commerce_carts
  FOR INSERT
  TO commerce_cart_shopper
  WITH CHECK (
    merchant_id = nullif((select auth.jwt() ->> 'cart_merchant_id'), '')::uuid
    AND (select auth.jwt() ->> 'cart_scope') = 'bootstrap'
    AND (select auth.jwt() ->> 'cart_id') IS NULL
  );

-- Own lines, gated by the same live grant as the cart.
DROP POLICY IF EXISTS commerce_cart_lines_shopper_select ON public.commerce_cart_lines;
CREATE POLICY commerce_cart_lines_shopper_select
  ON public.commerce_cart_lines
  FOR SELECT
  TO commerce_cart_shopper
  USING (
    merchant_id = nullif((select auth.jwt() ->> 'cart_merchant_id'), '')::uuid
    AND cart_id = nullif((select auth.jwt() ->> 'cart_id'), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM public.commerce_cart_grants g
      WHERE g.id = nullif((select auth.jwt() ->> 'cart_grant_id'), '')::uuid
        AND g.cart_id = public.commerce_cart_lines.cart_id
        AND g.merchant_id = public.commerce_cart_lines.merchant_id
        AND g.principal_id = (select auth.jwt() ->> 'cart_principal_id')
        AND g.expires_at > now()
        AND g.revoked_at IS NULL
    )
  );

-- Creation receipts: readable by the owning principal for retry recovery,
-- writable only through the bootstrap scope before a cart ID exists.
DROP POLICY IF EXISTS commerce_cart_creation_requests_shopper_select ON public.commerce_cart_creation_requests;
CREATE POLICY commerce_cart_creation_requests_shopper_select
  ON public.commerce_cart_creation_requests
  FOR SELECT
  TO commerce_cart_shopper
  USING (
    merchant_id = nullif((select auth.jwt() ->> 'cart_merchant_id'), '')::uuid
    AND principal_id = (select auth.jwt() ->> 'cart_principal_id')
  );

DROP POLICY IF EXISTS commerce_cart_creation_requests_shopper_bootstrap_insert ON public.commerce_cart_creation_requests;
CREATE POLICY commerce_cart_creation_requests_shopper_bootstrap_insert
  ON public.commerce_cart_creation_requests
  FOR INSERT
  TO commerce_cart_shopper
  WITH CHECK (
    merchant_id = nullif((select auth.jwt() ->> 'cart_merchant_id'), '')::uuid
    AND principal_id = (select auth.jwt() ->> 'cart_principal_id')
    AND (select auth.jwt() ->> 'cart_scope') = 'bootstrap'
  );

-- Internal outbox lease access for the publisher worker.
DROP POLICY IF EXISTS commerce_cart_events_worker_select ON public.commerce_cart_events;
CREATE POLICY commerce_cart_events_worker_select
  ON public.commerce_cart_events
  FOR SELECT
  TO commerce_cart_worker
  USING (true);

DROP POLICY IF EXISTS commerce_cart_events_worker_update ON public.commerce_cart_events;
CREATE POLICY commerce_cart_events_worker_update
  ON public.commerce_cart_events
  FOR UPDATE
  TO commerce_cart_worker
  USING (true)
  WITH CHECK (true);

-- Bounded retention cleanup. Deletes only rows past their retention
-- horizon and flips only checkout-free expired carts; never touches
-- active checkouts or unexpired retry receipts.
CREATE OR REPLACE FUNCTION public.cleanup_commerce_carts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.commerce_cart_operations WHERE expires_at < now();
  DELETE FROM public.commerce_cart_creation_requests WHERE expires_at < now();
  DELETE FROM public.commerce_cart_events WHERE expires_at < now();
  DELETE FROM public.commerce_cart_handoffs WHERE expires_at < now() - interval '1 day';
  UPDATE public.commerce_carts
  SET state = 'expired', updated_at = now()
  WHERE state = 'active' AND expires_at < now() AND checkout_session_id IS NULL;
END;
$$;

ALTER FUNCTION public.cleanup_commerce_carts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cleanup_commerce_carts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_commerce_carts() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_commerce_carts() TO commerce_cart_worker;

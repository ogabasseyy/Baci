-- Constrain the bootstrap cart INSERT policy to the exact row shape
-- canonical creation produces: the shopper role's direct insert path
-- previously accepted arbitrary state, version, checkout binding, and
-- unbounded expiry from any holder of a bootstrap-scoped JWT, bypassing
-- the commerce_cart_create RPC invariants.
DROP POLICY IF EXISTS commerce_carts_shopper_bootstrap_insert
  ON public.commerce_carts;
CREATE POLICY commerce_carts_shopper_bootstrap_insert
  ON public.commerce_carts
  FOR INSERT
  TO commerce_cart_shopper
  WITH CHECK (
    merchant_id = nullif((select auth.jwt() ->> 'cart_merchant_id'), '')::uuid
    AND (select auth.jwt() ->> 'cart_scope') = 'bootstrap'
    AND (select auth.jwt() ->> 'cart_id') IS NULL
    AND state = 'active'
    AND version = 1
    AND checkout_session_id IS NULL
    AND expires_at > now()
    AND expires_at <= now() + interval '7 days'
  );

-- Run only on an owned disposable database. No customer data or orders.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE public.commerce_cart_handoffs(id uuid, merchant_id uuid, handoff_hash text);
CREATE FUNCTION public.commerce_cart_handoff_merchant(p_handoff_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT merchant_id FROM public.commerce_cart_handoffs WHERE id = p_handoff_id
$$;
GRANT EXECUTE ON FUNCTION public.commerce_cart_handoff_merchant(uuid) TO anon;
INSERT INTO public.commerce_cart_handoffs VALUES
('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','owned-token-hash');
\if :install_guard
\ir ../migrations/20261015120000_commerce_cart_handoff_merchant_token.sql
\endif
DO $$ BEGIN
  IF to_regprocedure('public.commerce_cart_handoff_merchant(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'identifier-only lookup remains callable';
  END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF public.commerce_cart_handoff_merchant('11111111-1111-4111-8111-111111111111','owned-token-hash')
      IS DISTINCT FROM '22222222-2222-4222-8222-222222222222'::uuid THEN
    RAISE EXCEPTION 'valid token lookup failed';
  END IF;
  IF public.commerce_cart_handoff_merchant('11111111-1111-4111-8111-111111111111','wrong') IS NOT NULL
    OR public.commerce_cart_handoff_merchant('11111111-1111-4111-8111-111111111111',NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid token disclosed merchant';
  END IF;
END $$;
RESET ROLE;
-- Also tolerate environments that already contain the corrected signature.
\ir ../migrations/20261015120000_commerce_cart_handoff_merchant_token.sql
ROLLBACK;

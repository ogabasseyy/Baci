-- Return the live grant's expiry alongside its operations so proof
-- renewal can cap the renewed proof at the authoritative grant expiry
-- instead of the cart expiry, which another linked session can extend
-- beyond this grant.
CREATE OR REPLACE FUNCTION public.commerce_cart_grant_operations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_operations text[];
  v_expires_at timestamptz;
BEGIN
  IF v_claims ->> 'role' IS DISTINCT FROM 'commerce_cart_shopper'
    OR v_claims ->> 'cart_scope' IS DISTINCT FROM 'session'
    OR jsonb_typeof(v_claims -> 'exp') IS DISTINCT FROM 'number'
    OR coalesce((v_claims ->> 'exp')::numeric, 0) <= extract(epoch FROM now())
  THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized');
  END IF;
  IF NOT public.commerce_cart_device_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized');
  END IF;
  SELECT allowed_operations, expires_at INTO v_operations, v_expires_at
  FROM public.commerce_cart_grants
  WHERE id = (v_claims ->> 'cart_grant_id')::uuid
    AND merchant_id = (v_claims ->> 'cart_merchant_id')::uuid
    AND cart_id = (v_claims ->> 'cart_id')::uuid
    AND principal_id = v_claims ->> 'cart_principal_id'
    AND expires_at > now()
    AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'allowedOperations', to_jsonb(v_operations),
    'grantExpiresAt', v_expires_at
  );
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('ok', false, 'code', 'unauthorized');
END $$;

REVOKE ALL ON FUNCTION public.commerce_cart_grant_operations()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commerce_cart_grant_operations()
  TO commerce_cart_shopper;

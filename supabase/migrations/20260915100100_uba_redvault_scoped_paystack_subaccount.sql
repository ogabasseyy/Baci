CREATE OR REPLACE FUNCTION public.get_storefront_redvault_paystack_subaccount(
  p_merchant_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims jsonb := COALESCE((SELECT auth.jwt()), '{}'::jsonb);
BEGIN
  IF v_claims->>'storefront_order_context' IS DISTINCT FROM 'route'
    OR v_claims->>'storefront_order_merchant_id' IS DISTINCT FROM p_merchant_id::text THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;

  RETURN (
    SELECT NULLIF(pg_catalog.btrim(merchant.paystack_subaccount_code), '')
    FROM public.merchants AS merchant
    WHERE merchant.id = p_merchant_id
  );
END;
$$;
ALTER FUNCTION public.get_storefront_redvault_paystack_subaccount(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_storefront_redvault_paystack_subaccount(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_redvault_paystack_subaccount(uuid)
  TO authenticated;

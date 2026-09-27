CREATE OR REPLACE FUNCTION public.get_storefront_redvault_checkout_replay(p_checkout_key text)
RETURNS TABLE (order_id uuid, quote_payload jsonb, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_merchant_id uuid := NULLIF(auth.jwt()->>'storefront_order_merchant_id', '')::uuid;
  v_customer_email text := lower(trim(auth.jwt()->>'storefront_redvault_customer_email'));
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route'
    OR v_merchant_id IS DISTINCT FROM '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
    OR v_customer_email IS NULL OR NULLIF(trim(p_checkout_key), '') IS NULL THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  RETURN QUERY
  SELECT application.order_id, application.quote_payload, application.status
  FROM private.uba_redvault_applications AS application
  WHERE application.merchant_id = v_merchant_id
    AND application.customer_email = v_customer_email
    AND application.checkout_key = trim(p_checkout_key)
    AND application.user_id IS NOT DISTINCT FROM auth.uid()
    AND application.status IN ('draft', 'pending');
END;
$$;
ALTER FUNCTION public.get_storefront_redvault_checkout_replay(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_storefront_redvault_checkout_replay(text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_redvault_checkout_replay(text)
  TO authenticated;

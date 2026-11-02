CREATE OR REPLACE FUNCTION public.set_customer_wallet_phone(
  p_merchant_id uuid, p_expected_user_id uuid, p_phone text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE updated record;
BEGIN
  IF auth.uid() IS NULL OR p_expected_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Customer identity unavailable' USING ERRCODE='42501';
  END IF;
  IF p_phone IS NULL OR btrim(p_phone) !~ '^\+?[0-9]{10,15}$' THEN
    RAISE EXCEPTION 'Valid phone number required' USING ERRCODE='22023';
  END IF;
  UPDATE public.customers SET phone=btrim(p_phone)
  WHERE merchant_id=p_merchant_id AND user_id=auth.uid() AND deleted_at IS NULL
  RETURNING id,user_id,email,first_name,last_name,phone,loyalty_points,
    username,username_changed_at,date_of_birth INTO updated;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer profile unavailable' USING ERRCODE='42501';
  END IF;
  RETURN to_jsonb(updated);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_customer_wallet_phone(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_customer_wallet_phone(uuid,uuid,text) TO authenticated;

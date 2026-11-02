CREATE OR REPLACE FUNCTION public.set_customer_wallet_profile(
  p_merchant_id uuid, p_expected_user_id uuid, p_first_name text, p_last_name text
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
  IF p_first_name IS NULL OR p_last_name IS NULL
    OR length(btrim(p_first_name)) NOT BETWEEN 1 AND 100
    OR length(btrim(p_last_name)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Valid first and last name required' USING ERRCODE='22023';
  END IF;
  UPDATE public.customers SET first_name=btrim(p_first_name), last_name=btrim(p_last_name)
  WHERE merchant_id=p_merchant_id AND user_id=auth.uid() AND deleted_at IS NULL
  RETURNING id,user_id,email,first_name,last_name,phone,loyalty_points,
    username,username_changed_at,date_of_birth INTO updated;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer profile unavailable' USING ERRCODE='42501';
  END IF;
  RETURN to_jsonb(updated);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_customer_wallet_profile(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_customer_wallet_profile(uuid,uuid,text,text) TO authenticated;

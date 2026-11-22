ALTER FUNCTION public.confirm_gift_card_wallet_quote(text, text) SET SCHEMA private;

REVOKE ALL ON FUNCTION private.confirm_gift_card_wallet_quote(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.confirm_gift_card_wallet_quote(p_payload text, p_signature text)
RETURNS TABLE(order_id uuid, order_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'invalid_gift_card_quote' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT confirmation.order_id, confirmation.order_status
    FROM private.confirm_gift_card_wallet_quote(p_payload, p_signature) AS confirmation;
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'invalid_gift_card_quote' USING ERRCODE = '22023';
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_gift_card_wallet_quote(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_gift_card_wallet_quote(text, text)
  TO authenticated;

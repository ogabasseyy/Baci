-- Read the integer captured amount directly from the saved attempt.
-- PostgreSQL checks the persisted major-unit value against that amount
-- without reconstructing kobo from a JavaScript number.
CREATE FUNCTION public.get_bank_card_offer_refundable_amount(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid, p_reference text
) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.payable_kobo
  FROM private.bank_card_offer_order_snapshots s
  WHERE s.order_id = p_order_id AND s.merchant_id = p_merchant_id
    AND s.payable_kobo BETWEEN 1 AND 9007199254740991
    AND public.bank_card_offer_refund_capture_matches(
      p_order_id, p_merchant_id, p_transaction_id, p_reference, s.payable_kobo
    );
$$;
REVOKE ALL ON FUNCTION public.get_bank_card_offer_refundable_amount(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_bank_card_offer_refundable_amount(uuid, uuid, uuid, text)
  TO service_role;

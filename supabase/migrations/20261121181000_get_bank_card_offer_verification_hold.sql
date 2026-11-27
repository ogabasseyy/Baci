-- Use the same scoped verification authority as the fresh provider read.
-- The caller reads this boolean after contacting Paystack so a recorded
-- reversal or unresolved dispute cannot be overridden by provider lag.
CREATE FUNCTION public.get_bank_card_offer_verification_hold(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.bank_card_offer_reversal_recorded(p_transaction_id)
    WHERE public.get_bank_card_offer_verification_context(
      p_order_id, p_merchant_id, p_transaction_id
    ) IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_bank_card_offer_verification_hold(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_bank_card_offer_verification_hold(uuid, uuid, uuid)
  TO authenticated;

-- Fresh bank-offer orders must have a usable Paystack merchant configuration.
-- A replay reads the saved order without inserting, so recovery survives a
-- later account suspension. A failed check rolls back the whole checkout.
CREATE FUNCTION private.require_paystack_for_bank_card_offer_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_subaccount text;
  v_enabled boolean;
BEGIN
  SELECT paystack_subaccount_code INTO v_subaccount
    FROM public.merchants WHERE id = NEW.merchant_id FOR SHARE;
  SELECT paystack_enabled INTO v_enabled
    FROM public.merchant_feature_settings WHERE merchant_id = NEW.merchant_id FOR SHARE;
  IF (v_subaccount ~ '^ACCT_[A-Za-z0-9]+$') IS NOT TRUE
    OR COALESCE(v_enabled, true) IS NOT TRUE
  THEN RAISE EXCEPTION 'bank_card_offer_paystack_unavailable'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.require_paystack_for_bank_card_offer_order()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER require_paystack_for_bank_card_offer_order
  BEFORE INSERT ON public.orders
  FOR EACH ROW WHEN (NEW.payment_method = 'bank_card_offer')
  EXECUTE FUNCTION private.require_paystack_for_bank_card_offer_order();

-- A completed transaction can replay after inventory handling returned the
-- order to pending. The order transition still requires an unreversed capture,
-- even when complete_order_gateway_payment has no transaction status to change.
CREATE OR REPLACE FUNCTION private.guard_bank_card_offer_order_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.payment_method = 'bank_card_offer'
    AND (NEW.payment_method IS DISTINCT FROM OLD.payment_method
      OR (NEW.payment_status IN ('paid', 'partially_paid', 'bnpl_approved')
        AND NEW.payment_status IS DISTINCT FROM OLD.payment_status))
    AND EXISTS (SELECT 1 FROM private.bank_card_offer_order_snapshots WHERE order_id = OLD.id)
  THEN
    IF NEW.payment_method IS DISTINCT FROM OLD.payment_method
      OR NEW.payment_status <> 'paid'
      OR NOT EXISTS (
        SELECT 1 FROM private.bank_card_offer_payment_attempts a
        WHERE a.order_id = OLD.id AND a.verified_evidence IS NOT NULL
          AND NOT private.bank_card_offer_reversal_recorded(a.transaction_id)
      )
    THEN RAISE EXCEPTION 'bank_card_offer_payment_not_verified'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

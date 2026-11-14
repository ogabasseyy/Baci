-- Preserve safe method-only exits under the existing no-liability fence.
-- Take locks without waiting before that trigger executes, avoiding a
-- workflow/order lock inversion with provider and cancellation paths.
CREATE FUNCTION oxygen_private.lock_financial_edit_payment_exit(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(oxygen_private.financial_edit_lock_key(p_order_id)) THEN
  PERFORM oxygen_private.reject_financial_edit(p_order_id,true);
 END IF;
 BEGIN
  PERFORM 1 FROM public.oxygen_workflows WHERE order_id=p_order_id FOR UPDATE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN
  PERFORM oxygen_private.reject_financial_edit(p_order_id,true);
 END;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.lock_financial_edit_payment_exit(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION oxygen_private.guard_order_financial_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF ROW(OLD.merchant_id,OLD.customer_id,OLD.payment_method,OLD.currency,OLD.subtotal,OLD.shipping_fee,OLD.gift_wrapping_fee,OLD.discount_amount,OLD.tax_basis,OLD.tax_amount,OLD.tax_exclusive_amount,OLD.tax_inclusive_amount,OLD.total)
  IS DISTINCT FROM ROW(NEW.merchant_id,NEW.customer_id,NEW.payment_method,NEW.currency,NEW.subtotal,NEW.shipping_fee,NEW.gift_wrapping_fee,NEW.discount_amount,NEW.tax_basis,NEW.tax_amount,NEW.tax_exclusive_amount,NEW.tax_inclusive_amount,NEW.total)
 THEN
  IF OLD.payment_method='oxygen' AND NEW.payment_method IS DISTINCT FROM OLD.payment_method
   AND ROW(OLD.merchant_id,OLD.customer_id,OLD.currency,OLD.subtotal,OLD.shipping_fee,OLD.gift_wrapping_fee,OLD.discount_amount,OLD.tax_basis,OLD.tax_amount,OLD.tax_exclusive_amount,OLD.tax_inclusive_amount,OLD.total)
    IS NOT DISTINCT FROM ROW(NEW.merchant_id,NEW.customer_id,NEW.currency,NEW.subtotal,NEW.shipping_fee,NEW.gift_wrapping_fee,NEW.discount_amount,NEW.tax_basis,NEW.tax_amount,NEW.tax_exclusive_amount,NEW.tax_inclusive_amount,NEW.total)
  THEN PERFORM oxygen_private.lock_financial_edit_payment_exit(OLD.id);
  ELSE PERFORM oxygen_private.assert_financial_edit_allowed(OLD.id);
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.block_active_shipping_charge_quote_replacement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.selected_quote_id IS NOT DISTINCT FROM OLD.selected_quote_id THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.merchant_shipping_charges AS c WHERE c.order_id = OLD.id AND c.status IN ('reserved', 'provider_submitting', 'needs_reconciliation')) THEN
    RAISE EXCEPTION 'active_shipping_charge_quote_replacement_blocked' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS block_active_shipping_charge_quote_replacement ON public.orders;
CREATE TRIGGER block_active_shipping_charge_quote_replacement
  BEFORE UPDATE OF selected_quote_id ON public.orders FOR EACH ROW
  EXECUTE FUNCTION private.block_active_shipping_charge_quote_replacement();

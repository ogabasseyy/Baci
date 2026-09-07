-- Reject shipping_address edits while a wallet shipping charge is active.
-- Quote replacement is already blocked for reserved/provider_submitting/
-- needs_reconciliation charges; address edits must match that gate so a
-- concurrent Edit Order path cannot change destination after receiver
-- validation while GIGL still ships to the quoted address (or leave funds
-- held on a reserved charge that cannot be re-quoted).

CREATE OR REPLACE FUNCTION private.block_active_shipping_charge_address_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.shipping_address IS NOT DISTINCT FROM OLD.shipping_address THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.order_id = OLD.id
      AND charge.status IN (
        'reserved',
        'provider_submitting',
        'needs_reconciliation'
      )
  ) THEN
    RAISE EXCEPTION 'active_shipping_charge_address_edit_blocked'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.block_active_shipping_charge_address_edit()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS block_active_shipping_charge_address_edit
  ON public.orders;

CREATE TRIGGER block_active_shipping_charge_address_edit
  BEFORE UPDATE OF shipping_address ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.block_active_shipping_charge_address_edit();

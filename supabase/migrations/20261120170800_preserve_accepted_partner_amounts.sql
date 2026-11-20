-- Booking, tracking and refunds can proceed without rewriting the merchandise,
-- delivery and tax amounts on the original settled order.
CREATE FUNCTION private.preserve_accepted_partner_amounts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.accepted_partner_orders AS a WHERE a.order_id = OLD.id) THEN
    RAISE EXCEPTION 'partner_settled_order_amounts_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.preserve_accepted_partner_amounts()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER preserve_accepted_partner_amounts
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (
    NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.shipping_fee IS DISTINCT FROM OLD.shipping_fee
    OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
    OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.currency IS DISTINCT FROM OLD.currency
  )
  EXECUTE FUNCTION private.preserve_accepted_partner_amounts();

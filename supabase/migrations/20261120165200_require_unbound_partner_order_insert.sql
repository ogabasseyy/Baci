-- Partner intake starts unbound. The existing admin binder handles later
-- merchant-wallet fulfillment after the partner settlement has been recorded.
CREATE FUNCTION private.require_unbound_partner_order_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'partner_order_shipping_must_start_unbound' USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION private.require_unbound_partner_order_insert()
  FROM PUBLIC, anon, authenticated, service_role;

-- Check the stored values after the shipping economics trigger normalizes them.
CREATE TRIGGER require_unbound_partner_order_insert
  AFTER INSERT ON public.orders
  FOR EACH ROW
  WHEN (
    NEW.source = 'partner'
    AND (
      NEW.selected_quote_id IS NOT NULL
      OR NEW.shipping_funding_source IS NOT NULL
      OR COALESCE(NEW.shipping_platform_retained_amount, 0) <> 0
    )
  )
  EXECUTE FUNCTION private.require_unbound_partner_order_insert();

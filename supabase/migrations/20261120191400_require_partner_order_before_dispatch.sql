-- Partner orders start without dispatch evidence or a bound quote.
DROP TRIGGER require_unbound_partner_order_insert ON public.orders;
CREATE TRIGGER require_unbound_partner_order_insert
  AFTER INSERT ON public.orders
  FOR EACH ROW
  WHEN (
    NEW.source = 'partner'
    AND (
      NEW.selected_quote_id IS NOT NULL
      OR NEW.shipment_id IS NOT NULL
      OR NEW.tracking_number IS NOT NULL
      OR NEW.shipping_status IN (
        'shipped', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'completed'
      )
      OR NEW.shipping_funding_source IS NOT NULL
      OR COALESCE(NEW.shipping_platform_retained_amount, 0) <> 0
    )
  )
  EXECUTE FUNCTION private.require_unbound_partner_order_insert();

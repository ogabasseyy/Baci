DROP TRIGGER IF EXISTS persist_redvault_surviving_shipment_quantity ON public.variant_inventory;

CREATE OR REPLACE FUNCTION private.persist_redvault_surviving_shipment_quantity_from_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order_item_id uuid := COALESCE(NEW.order_item_id, OLD.order_item_id);
BEGIN
  IF v_order_item_id IS NULL OR (NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.order_item_id IS NOT DISTINCT FROM OLD.order_item_id) THEN
    RETURN NEW;
  END IF;
  UPDATE public.order_items AS item
  SET fulfillment_data = COALESCE(item.fulfillment_data, '{}'::jsonb) || jsonb_build_object(
    'fulfillmentQuantity', (
      SELECT count(*) FROM public.variant_inventory AS inventory
      WHERE inventory.order_item_id = item.id AND inventory.status = 'reserved'
    )
  )
  FROM public.orders AS order_row
  WHERE item.id = v_order_item_id
    AND order_row.id = item.order_id
    AND order_row.payment_method = 'uba_redvault';
  RETURN NEW;
END;
$$;

ALTER FUNCTION private.persist_redvault_surviving_shipment_quantity_from_inventory() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.persist_redvault_surviving_shipment_quantity_from_inventory()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER persist_redvault_surviving_shipment_quantity
  AFTER UPDATE OF status, order_item_id ON public.variant_inventory
  FOR EACH ROW EXECUTE FUNCTION private.persist_redvault_surviving_shipment_quantity_from_inventory();

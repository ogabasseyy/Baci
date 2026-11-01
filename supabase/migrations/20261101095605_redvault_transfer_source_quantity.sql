-- Refresh both sides of a direct REDVAULT serialized reservation transfer.
-- Offer lines continue to derive shipment quantities from their purchased stock.
CREATE OR REPLACE FUNCTION private.persist_redvault_surviving_shipment_quantity_from_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order_item_id uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.order_item_id IS NOT DISTINCT FROM OLD.order_item_id THEN
    RETURN NEW;
  END IF;

  -- Lock affected item rows in a consistent order. NULLs and duplicate
  -- IDs need no separate update.
  FOR v_order_item_id IN
    SELECT DISTINCT id FROM unnest(ARRAY[OLD.order_item_id, NEW.order_item_id]) AS ids(id)
    WHERE id IS NOT NULL ORDER BY id
  LOOP
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
      AND order_row.payment_method = 'uba_redvault'
      AND item.offer_line IS DISTINCT FROM TRUE
      AND item.product_offer_id IS NULL
      AND item.offer_labels_snapshotted IS DISTINCT FROM TRUE;
  END LOOP;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.persist_redvault_surviving_shipment_quantity_from_inventory() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.persist_redvault_surviving_shipment_quantity_from_inventory()
  FROM PUBLIC, anon, authenticated, service_role;

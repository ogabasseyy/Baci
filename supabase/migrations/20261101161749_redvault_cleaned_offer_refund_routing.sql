-- Record exactly which reservation events were invalidated by legacy offer
-- cleanup. Event IDs avoid relying on transaction-start timestamps for order.
CREATE TABLE private.legacy_offer_cleanup_reservations (
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  reservation_event_id uuid NOT NULL REFERENCES private.variant_inventory_events(id) ON DELETE CASCADE,
  PRIMARY KEY (order_item_id, reservation_event_id)
);
CREATE INDEX legacy_offer_cleanup_reservations_event_idx
  ON private.legacy_offer_cleanup_reservations (reservation_event_id);
ALTER TABLE private.legacy_offer_cleanup_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_offer_cleanup_reservations_deny
  ON private.legacy_offer_cleanup_reservations AS RESTRICTIVE
  FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON private.legacy_offer_cleanup_reservations FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
 definition text := pg_catalog.pg_get_functiondef('private.release_stale_offer_line_serialized_units(uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
 old text := $old$  -- Reconcile the line snapshot with actually-attached units.$old$;
 replacement text := $new$  INSERT INTO private.legacy_offer_cleanup_reservations (order_item_id, reservation_event_id)
  SELECT p_item_id, event.id
  FROM private.variant_inventory_events event
  WHERE event.order_id = p_order_id AND event.order_item_id = p_item_id
    AND event.event_type = 'reserved'
    AND event.inventory_unit_id::text = ANY(v_released_ids)
  ON CONFLICT DO NOTHING;
  -- Reconcile the line snapshot with actually-attached units.$new$;
BEGIN
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN
  RAISE EXCEPTION 'legacy offer cleanup source mismatch';
 END IF;
 EXECUTE replace(definition,old,replacement);
END;
$$;

CREATE OR REPLACE FUNCTION private.redvault_line_was_serialized(p_order_id uuid, p_order_item_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT CASE WHEN EXISTS (
   SELECT 1 FROM public.order_items item
   WHERE item.id=p_order_item_id AND item.order_id=p_order_id AND item.product_offer_id IS NOT NULL
 ) AND NOT EXISTS (
   SELECT 1 FROM public.variant_inventory inventory
   WHERE inventory.order_id=p_order_id AND inventory.order_item_id=p_order_item_id
 ) AND EXISTS (
   SELECT 1 FROM private.legacy_offer_cleanup_reservations cleanup
   WHERE cleanup.order_item_id=p_order_item_id
 ) AND NOT EXISTS (
   SELECT 1 FROM private.variant_inventory_events event
   WHERE event.order_id=p_order_id AND event.order_item_id=p_order_item_id
     AND (event.event_type='sold' OR (event.event_type='reserved' AND NOT EXISTS (
       SELECT 1 FROM private.legacy_offer_cleanup_reservations cleanup
       WHERE cleanup.order_item_id=p_order_item_id AND cleanup.reservation_event_id=event.id
     )))
 ) THEN false ELSE (
   EXISTS (SELECT 1 FROM public.variant_inventory inventory WHERE inventory.order_id=p_order_id AND inventory.order_item_id=p_order_item_id)
   OR EXISTS (SELECT 1 FROM private.variant_inventory_events event WHERE event.order_id=p_order_id AND event.order_item_id=p_order_item_id AND event.event_type='reserved')
 ) END;
$$;

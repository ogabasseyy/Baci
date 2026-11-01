-- A condition-only offer has no exact-offer snapshot. The private protocol
-- marker retains its identity after catalog deletion for existing units.
DO $$
DECLARE
 definition text := pg_catalog.pg_get_functiondef('private.confirm_order_inventory_reservations(uuid,uuid)'::regprocedure);
 old text := $old$    v_condition_offer_id := coalesce(v_item.product_offer_id, v_item.offer_id, v_item.offer_id_snapshot);$old$;
 replacement text := $new$    v_condition_offer_id := coalesce(v_item.product_offer_id, v_item.offer_id, v_item.offer_id_snapshot,
      (SELECT marker.offer_id FROM private.serialized_offer_order_items marker
       WHERE marker.order_item_id = v_item.id AND marker.merchant_id = p_merchant_id));$new$;
BEGIN
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN
  RAISE EXCEPTION 'serialized condition confirmation source mismatch';
 END IF;
 EXECUTE replace(definition,old,replacement);
END;
$$;

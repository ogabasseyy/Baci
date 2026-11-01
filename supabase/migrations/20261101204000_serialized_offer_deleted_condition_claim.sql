-- Replay an existing condition-only hold after its catalog offer is deleted.
-- The marker identifies that hold; it does not permit a new claim.
DO $$
DECLARE
 definition text := pg_catalog.pg_get_functiondef('private.claim_variant_inventory_units_for_order_item_internal(uuid,uuid,uuid)'::regprocedure);
 old text := $old$  v_condition_offer_id := coalesce(v_product_offer_id, v_exact_offer_id, v_offer_id_snapshot);$old$;
 replacement text := $new$  v_condition_offer_id := coalesce(v_product_offer_id, v_exact_offer_id, v_offer_id_snapshot,
    (SELECT marker.offer_id FROM private.serialized_offer_order_items marker
     WHERE marker.order_item_id = p_order_item_id AND marker.merchant_id = p_merchant_id));$new$;
BEGIN
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN
  RAISE EXCEPTION 'serialized condition claim source mismatch';
 END IF;
 definition := replace(definition,old,replacement);
 old := $old$  IF v_offer_id_snapshot IS NOT NULL AND v_product_offer_id IS NULL AND v_exact_offer_id IS NULL$old$;
 replacement := $new$  IF v_condition_offer_id IS NOT NULL AND v_product_offer_id IS NULL AND v_exact_offer_id IS NULL$new$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN
  RAISE EXCEPTION 'serialized condition claim deletion source mismatch';
 END IF;
 definition := replace(definition,old,replacement);
 old := $old$      WHERE vi.order_item_id = p_order_item_id AND vi.condition_offer_id = v_offer_id_snapshot$old$;
 replacement := $new$      WHERE vi.order_item_id = p_order_item_id AND vi.condition_offer_id = v_condition_offer_id$new$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN
  RAISE EXCEPTION 'serialized condition claim retained unit source mismatch';
 END IF;
 EXECUTE replace(definition,old,replacement);
END;
$$;

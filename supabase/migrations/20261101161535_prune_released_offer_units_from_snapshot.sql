-- Keep sold/other attached units in a mixed legacy snapshot while removing
-- exactly the reservations released by the offer cleanup.
DO $$
DECLARE
 definition text := pg_catalog.pg_get_functiondef('private.release_stale_offer_line_serialized_units(uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
 old text;
 replacement text;
BEGIN
 old := $old$  v_released_count integer := 0;$old$;
 replacement := $new$  v_released_count integer := 0;
  v_released_ids text[] := ARRAY[]::text[];$new$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN RAISE EXCEPTION 'offer release declaration source mismatch'; END IF;
 definition := replace(definition,old,replacement);
 old := $old$    v_released_count := v_released_count + 1;$old$;
 replacement := $new$    v_released_count := v_released_count + 1;
    v_released_ids := array_append(v_released_ids, v_release_id::text);$new$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN RAISE EXCEPTION 'offer release count source mismatch'; END IF;
 definition := replace(definition,old,replacement);
 old := $old$  IF v_current_fulfillment IS NOT NULL AND NOT EXISTS ($old$;
 replacement := $new$  IF v_released_count > 0 AND jsonb_typeof(v_current_fulfillment->'inventoryUnits') = 'array' THEN
    v_current_fulfillment := jsonb_set(v_current_fulfillment, '{inventoryUnits}', (
      SELECT COALESCE(jsonb_agg(entry.value ORDER BY entry.ordinality) FILTER (
        WHERE NOT COALESCE(entry.value->>'inventoryUnitId' = ANY(v_released_ids), false)
      ), '[]'::jsonb)
      FROM jsonb_array_elements(v_current_fulfillment->'inventoryUnits') WITH ORDINALITY AS entry(value, ordinality)
    ));
    UPDATE public.order_items AS oi SET fulfillment_data = v_current_fulfillment WHERE oi.id = p_item_id;
  END IF;
  IF v_current_fulfillment IS NOT NULL AND NOT EXISTS ($new$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN RAISE EXCEPTION 'offer release snapshot source mismatch'; END IF;
 EXECUTE replace(definition,old,replacement);
END;
$$;

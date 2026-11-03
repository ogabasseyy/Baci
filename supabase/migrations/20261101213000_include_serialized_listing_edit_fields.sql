-- Inventory editing round-trips the listing, so the listing must include the
-- current notes. Keep the existing merchant authorization and pagination intact.
DO $$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'private.list_variant_inventory_units(uuid,uuid,uuid,text,text,uuid,integer,timestamptz,uuid)'::regprocedure
  );
  old_select text := E'      vi.id,\n      pv.product_id,';
  new_select text := E'      vi.id,\n      vi.merchant_id,\n      vi.notes,\n      pv.product_id,';
  old_json text := E'        ''id'', v_row.id,\n        ''product_id'', v_row.product_id,';
  new_json text := E'        ''id'', v_row.id,\n        ''merchant_id'', v_row.merchant_id,\n        ''notes'', v_row.notes,\n        ''product_id'', v_row.product_id,';
BEGIN
  IF (length(definition) - length(replace(definition, old_select, ''))) / length(old_select) <> 1
     OR (length(definition) - length(replace(definition, old_json, ''))) / length(old_json) <> 1 THEN
    RAISE EXCEPTION 'serialized inventory listing fields source mismatch';
  END IF;
  EXECUTE replace(replace(definition, old_select, new_select), old_json, new_json);
END;
$$;

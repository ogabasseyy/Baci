-- Preserve exact offer IDs from verified legacy MCP carts. Reject malformed
-- values before projection; downstream migration still checks offer ownership.
DO $repair$
DECLARE
  v_definition text := pg_catalog.pg_get_functiondef('public.commerce_cart_legacy_owner_context(text,text)'::regprocedure);
  v_old text := $old$IF EXISTS(SELECT 1 FROM jsonb_array_elements(legacy.items) x WHERE x - 'product_id' - 'quantity' <> '{}'::jsonb) THEN RETURN jsonb_build_object('ok',false,'code','invalid_item'); END IF;$old$;
  v_new text := $new$IF EXISTS(SELECT 1 FROM jsonb_array_elements(legacy.items) x WHERE x - 'product_id' - 'quantity' - 'offer_id' <> '{}'::jsonb OR (x ? 'offer_id' AND jsonb_typeof(x->'offer_id') <> 'null' AND (jsonb_typeof(x->'offer_id') <> 'string' OR x->>'offer_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))) THEN RETURN jsonb_build_object('ok',false,'code','invalid_item'); END IF;$new$;
  v_old_projection text := $old$jsonb_build_object('item',jsonb_build_object('productId',x->>'product_id'),'quantity',x->'quantity')$old$;
  v_new_projection text := $new$jsonb_build_object('item',jsonb_build_object('productId',x->>'product_id') || CASE WHEN jsonb_typeof(x->'offer_id')='string' THEN jsonb_build_object('offerId',x->>'offer_id') ELSE '{}'::jsonb END,'quantity',x->'quantity')$new$;
  v_count integer;
BEGIN
  IF position(v_new IN v_definition)>0 AND position(v_new_projection IN v_definition)>0 THEN RETURN; END IF;
  v_count := (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old);
  IF v_count <> 1 THEN RAISE EXCEPTION 'legacy MCP offer allowlist source mismatch'; END IF;
  v_definition := replace(v_definition,v_old,v_new);
  v_count := (length(v_definition)-length(replace(v_definition,v_old_projection,'')))/length(v_old_projection);
  IF v_count <> 1 THEN RAISE EXCEPTION 'legacy MCP offer projection source mismatch'; END IF;
  EXECUTE replace(v_definition,v_old_projection,v_new_projection);
END;
$repair$;

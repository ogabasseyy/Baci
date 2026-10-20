-- Preserve product/variant/item lock ordering after the condition-aware leaf
-- replacement. Required source shape is asserted so schema drift fails closed.
DO $repair$
DECLARE function_oid oid; definition text; marker text := $marker$        AND NOT EXISTS(SELECT 1 FROM pg_temp.tmp_storefront_order_items t WHERE t.condition_offer_id IS NOT NULL AND t.product_id=oi.product_id AND t.variant_id IS NOT DISTINCT FROM oi.variant_id AND t.condition IS NOT DISTINCT FROM oi.condition)$marker$;
BEGIN
 SELECT p.oid INTO STRICT function_oid
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND p.proname='create_storefront_order_unchecked' AND p.pronargs=24;
 definition := pg_catalog.pg_get_functiondef(function_oid);
 IF position(marker || E'\n      ORDER BY oi.product_id, oi.variant_id, oi.id' IN definition)>0 THEN RETURN; END IF;
 IF position(marker || E'\n    LOOP' IN definition)=0 THEN
  RAISE EXCEPTION 'condition-aware serialized claim loop source does not match expected shape';
 END IF;
 definition := replace(definition, marker || E'\n    LOOP', marker || E'\n      ORDER BY oi.product_id, oi.variant_id, oi.id\n    LOOP');
 EXECUTE definition;
END $repair$;

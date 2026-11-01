-- Exact offers always consume their own finite pool, regardless of the
-- parent product's ordinary stock-management setting.
DO $repair$
DECLARE
 definition text := pg_catalog.pg_get_functiondef('public.commerce_cart_build_checkout_snapshot(uuid,uuid)'::regprocedure);
 old_call text := 'CASE WHEN offer.id IS NOT NULL THEN coalesce(p.manage_stock,true) WHEN policy.value=';
 new_call text := 'CASE WHEN l.offer_id IS NOT NULL AND offer.id IS NOT NULL THEN true WHEN offer.id IS NOT NULL THEN coalesce(p.manage_stock,true) WHEN policy.value=';
 matches integer;
BEGIN
 IF position(old_call IN definition)=0 AND position(new_call IN definition)>0 THEN RETURN; END IF;
 matches := (length(definition)-length(replace(definition,old_call,'')))/length(old_call);
 IF matches <> 1 THEN RAISE EXCEPTION 'exact offer allocation source mismatch: %',matches; END IF;
 EXECUTE replace(definition,old_call,new_call);
END;
$repair$;

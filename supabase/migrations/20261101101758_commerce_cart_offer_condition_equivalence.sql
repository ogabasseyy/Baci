-- Match the exact-offer writer: equivalent raw and canonical conditions
-- refer to the same stock lane, while unknown values fail closed.
DO $repair$
DECLARE
  v_definition text := pg_catalog.pg_get_functiondef('public.commerce_cart_build_checkout_snapshot(uuid,uuid)'::regprocedure);
  v_old text := $old$(l.condition IS NULL OR l.condition = discovery.canonical_product_condition(offer.condition))$old$;
  v_new text := $new$(l.condition IS NULL OR discovery.canonical_product_condition(l.condition) = discovery.canonical_product_condition(offer.condition))$new$;
  v_count integer;
BEGIN
  IF position(v_old IN v_definition)=0 AND position(v_new IN v_definition)>0 THEN RETURN; END IF;
  v_count := (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old);
  IF v_count <> 1 THEN RAISE EXCEPTION 'exact offer condition equivalence source mismatch'; END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END;
$repair$;

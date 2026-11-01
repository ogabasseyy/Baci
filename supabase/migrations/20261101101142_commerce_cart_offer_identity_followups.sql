-- The reviewed condition is sent to the order authority as purchase data.
-- Preserve the exact offer's live condition (e.g. refurbished), while the
-- eligibility predicate still compares its canonical discovery condition.
DO $repair$
DECLARE
  v_signature regprocedure := 'public.commerce_cart_build_checkout_snapshot(uuid,uuid)'::regprocedure;
  v_definition text := pg_catalog.pg_get_functiondef(v_signature);
  v_old text := 'THEN coalesce(l.condition, discovery.canonical_product_condition(offer.condition))';
  v_new text := 'THEN offer.condition';
  v_count integer;
BEGIN
  IF position(v_old IN v_definition) = 0 AND position(v_new IN v_definition) > 0 THEN
    RETURN;
  END IF;
  v_count := (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'exact offer snapshot condition source mismatch';
  END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END;
$repair$;

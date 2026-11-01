-- Handoff persistence reads staged flat lines, not nested input commands.
DO $repair$
DECLARE
 definition text := pg_catalog.pg_get_functiondef('public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)'::regprocedure);
 old_call text := $old$CASE WHEN public.commerce_cart_parse_offer_id(v_line) IS NULL THEN v_line ->> 'condition' ELSE NULL END);
    PERFORM public.commerce_cart_require_exact_offer$old$;
 new_call text := $new$CASE WHEN nullif(v_line ->> 'offerId', '') IS NULL THEN v_line ->> 'condition' ELSE NULL END);
    PERFORM public.commerce_cart_require_exact_offer$new$;
 matches integer;
BEGIN
 IF position(old_call IN definition)=0 AND position(new_call IN definition)>0 THEN RETURN; END IF;
 matches := (length(definition)-length(replace(definition,old_call,'')))/length(old_call);
 IF matches <> 1 THEN RAISE EXCEPTION 'staged handoff offer source mismatch: %',matches; END IF;
 EXECUTE replace(definition,old_call,new_call);
END;
$repair$;

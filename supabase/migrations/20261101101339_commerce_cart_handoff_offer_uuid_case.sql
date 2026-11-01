-- Offer IDs are UUIDs; accepted hex casing must not change handoff identity.
CREATE OR REPLACE FUNCTION pg_temp.patch_cart_offer_case(p_signature text,p_old text,p_new text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_definition text := pg_catalog.pg_get_functiondef(p_signature::regprocedure); v_count integer;
BEGIN
 IF position(p_old IN v_definition)=0 AND position(p_new IN v_definition)>0 THEN RETURN; END IF;
 v_count := (length(v_definition)-length(replace(v_definition,p_old,'')))/length(p_old);
 IF v_count <> 1 THEN RAISE EXCEPTION 'handoff offer UUID comparison source mismatch'; END IF;
 EXECUTE replace(v_definition,p_old,p_new);
END $$;
SELECT pg_temp.patch_cart_offer_case(
 'public.commerce_cart_redeem_handoff(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
 $old$nullif(line->'item'->>'offerId','') IS NOT DISTINCT FROM l.offer_id::text$old$,
 $new$public.commerce_cart_parse_offer_id(line) IS NOT DISTINCT FROM l.offer_id$new$);
SELECT pg_temp.patch_cart_offer_case(
 'public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
 $old$(v_resolution -> 'item' ->> 'offerId') IS NOT DISTINCT FROM public.commerce_cart_parse_offer_id(v_line)::text$old$,
 $new$public.commerce_cart_parse_offer_id(jsonb_build_object('item',v_resolution -> 'item')) IS NOT DISTINCT FROM public.commerce_cart_parse_offer_id(v_line)$new$);
SELECT pg_temp.patch_cart_offer_case(
 'public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
 $old$(s.value ->> 'offerId') IS NOT DISTINCT FROM (v_resolution -> 'item' ->> 'offerId')$old$,
 $new$nullif(lower(s.value ->> 'offerId'),'') IS NOT DISTINCT FROM nullif(lower(v_resolution -> 'item' ->> 'offerId'),'')$new$);

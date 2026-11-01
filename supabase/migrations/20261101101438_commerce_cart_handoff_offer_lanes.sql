-- Attachment siblings share the exact offer as well as the product lane.
DO $repair$
DECLARE
  v_definition text := pg_catalog.pg_get_functiondef('public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)'::regprocedure);
  v_old text := $old$    SELECT EXISTS (
      SELECT 1 FROM public.commerce_cart_lines l
      WHERE l.merchant_id=v_merchant AND l.cart_id IN (v_dest.id,v_incoming.id)
        AND l.product_id=v_product_id AND l.variant_id IS NOT DISTINCT FROM v_variant_id
        AND l.condition IS NOT DISTINCT FROM v_condition AND coalesce(l.options,'{}'::jsonb)=v_options
      GROUP BY l.cart_id HAVING count(*)>1
    ) OR EXISTS (
      SELECT 1 FROM public.commerce_cart_lines l
      WHERE l.merchant_id=v_merchant AND l.cart_id IN (v_dest.id,v_incoming.id)
        AND l.product_id=v_product_id AND l.variant_id IS NOT DISTINCT FROM v_variant_id
        AND l.condition IS NOT DISTINCT FROM v_condition AND coalesce(l.options,'{}'::jsonb)=v_options
      HAVING count(DISTINCT l.voucher_award_id)>1
    ) INTO v_attachment_lanes;$old$;
  v_new text := $new$    SELECT EXISTS (
      SELECT 1 FROM public.commerce_cart_lines l
      WHERE l.merchant_id=v_merchant AND l.cart_id IN (v_dest.id,v_incoming.id)
        AND l.product_id=v_product_id AND l.variant_id IS NOT DISTINCT FROM v_variant_id
        AND l.condition IS NOT DISTINCT FROM v_condition AND coalesce(l.options,'{}'::jsonb)=v_options
        AND l.offer_id IS NOT DISTINCT FROM public.commerce_cart_parse_offer_id(v_line)
      GROUP BY l.cart_id HAVING count(*)>1
    ) OR EXISTS (
      SELECT 1 FROM public.commerce_cart_lines l
      WHERE l.merchant_id=v_merchant AND l.cart_id IN (v_dest.id,v_incoming.id)
        AND l.product_id=v_product_id AND l.variant_id IS NOT DISTINCT FROM v_variant_id
        AND l.condition IS NOT DISTINCT FROM v_condition AND coalesce(l.options,'{}'::jsonb)=v_options
        AND l.offer_id IS NOT DISTINCT FROM public.commerce_cart_parse_offer_id(v_line)
      HAVING count(DISTINCT l.voucher_award_id)>1
    ) INTO v_attachment_lanes;$new$;
  v_count integer;
BEGIN
  IF position(v_old IN v_definition)=0 AND position(v_new IN v_definition)>0 THEN RETURN; END IF;
  v_count := (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old);
  IF v_count <> 1 THEN RAISE EXCEPTION 'handoff offer lane source mismatch'; END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END;
$repair$;

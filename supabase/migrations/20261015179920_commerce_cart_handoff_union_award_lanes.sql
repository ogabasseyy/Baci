-- Align the handoff coverage lane predicate with the shared merge
-- planner: two carts can each hold a single, different voucher award
-- for one product without either cart holding within-cart siblings.
-- Those are distinct entitlements, so attachment-lane matching must
-- also engage when the union across both carts holds more than one
-- distinct award for the base, not only when one cart repeats a base.
DO $repair$
DECLARE
  definition text;
  old text;
  replacement text;
BEGIN
  definition := pg_get_functiondef('public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)'::regprocedure);
  old := $old$    SELECT EXISTS (
      SELECT 1 FROM public.commerce_cart_lines l
      WHERE l.merchant_id=v_merchant AND l.cart_id IN (v_dest.id,v_incoming.id)
        AND l.product_id=v_product_id AND l.variant_id IS NOT DISTINCT FROM v_variant_id
        AND l.condition IS NOT DISTINCT FROM v_condition AND coalesce(l.options,'{}'::jsonb)=v_options
      GROUP BY l.cart_id HAVING count(*)>1
    ) INTO v_attachment_lanes;$old$;
  replacement := $new$    SELECT EXISTS (
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
    ) INTO v_attachment_lanes;$new$;
  IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'handoff coverage lane source mismatch';
  END IF;
  definition := replace(definition, old, replacement);
  EXECUTE definition;
END
$repair$;

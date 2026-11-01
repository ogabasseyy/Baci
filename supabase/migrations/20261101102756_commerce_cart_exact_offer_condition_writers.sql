-- Exact offers have their own merchant, product, condition, and availability
-- checks. Keep the parent-only condition guard for lines without an offer ID.
CREATE OR REPLACE FUNCTION pg_temp.patch_exact_offer_condition_writer(
  signature text, old_call text, new_call text, expected integer DEFAULT 1
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(signature::regprocedure);
  matches integer;
BEGIN
  IF position(old_call IN definition)=0 AND position(new_call IN definition)>0 THEN RETURN; END IF;
  matches := (length(definition)-length(replace(definition,old_call,'')))/length(old_call);
  IF matches <> expected THEN RAISE EXCEPTION 'exact offer condition writer source mismatch for %: %',signature,matches; END IF;
  EXECUTE replace(definition,old_call,new_call);
END $$;

SELECT pg_temp.patch_exact_offer_condition_writer(
 'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
 'public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);' || E'\n    v_neg_status:=',
 'public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, CASE WHEN public.commerce_cart_parse_offer_id(p_command) IS NULL THEN v_condition ELSE NULL END);' || E'\n    v_neg_status:='
);
SELECT pg_temp.patch_exact_offer_condition_writer(
 'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
 'public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);' || E'\n      v_neg_status :=',
 'public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, CASE WHEN public.commerce_cart_parse_offer_id(v_entry) IS NULL THEN v_condition ELSE NULL END);' || E'\n      v_neg_status :='
);
SELECT pg_temp.patch_exact_offer_condition_writer(
 'public.commerce_cart_create_device_impl(text,jsonb,text)',
 'public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);',
 'public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, CASE WHEN public.commerce_cart_parse_offer_id(v_line) IS NULL THEN v_condition ELSE NULL END);'
);
SELECT pg_temp.patch_exact_offer_condition_writer(
 'public.commerce_cart_migrate_legacy_owner_impl(text,text,text,jsonb,text,text)',
 'public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);',
 'public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, CASE WHEN public.commerce_cart_parse_offer_id(v_line) IS NULL THEN v_condition ELSE NULL END);'
);
SELECT pg_temp.patch_exact_offer_condition_writer(
 'public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
 $old$      v_line ->> 'condition');
    PERFORM public.commerce_cart_require_exact_offer$old$,
 $new$      CASE WHEN public.commerce_cart_parse_offer_id(v_line) IS NULL THEN v_line ->> 'condition' ELSE NULL END);
    PERFORM public.commerce_cart_require_exact_offer$new$
);

-- Quantity increases and negotiated repricing must revalidate the same exact
-- offer, while retaining the original condition guard for non-offer lines.
SELECT pg_temp.patch_exact_offer_condition_writer(
 'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
 'PERFORM public.commerce_cart_require_offer(v_merchant, v_line.product_id, v_line.variant_id, v_line.condition);',
 $new$PERFORM public.commerce_cart_require_offer(v_merchant, v_line.product_id, v_line.variant_id, CASE WHEN v_line.offer_id IS NULL THEN v_line.condition ELSE NULL END);
      PERFORM public.commerce_cart_require_exact_offer(v_merchant, v_line.product_id, v_line.condition, v_line.offer_id);$new$,
 2
);

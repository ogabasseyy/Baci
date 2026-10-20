-- Replace carries the full chosen union, including legal same-product offer
-- siblings. Quantity/assurance merge; voucher and normalized negotiation terms
-- distinguish identities. Preserve the final executor's other commands/caps.
DO $repair$
DECLARE
  definition text;
  replace_block text;
  repaired_block text;
  start_offset integer;
  end_offset integer;
  input_identity text := 'AND w.voucher_award IS NOT DISTINCT FROM v_voucher_award::uuid';
  stored_identity text := 'AND w.voucher_award IS NOT DISTINCT FROM l.voucher_award_id';
  offer_check text := 'PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);';
  normalized_status text := 'v_neg_status := public.commerce_cart_negotiation_status(v_merchant,v_product_id,v_variant_id,v_condition,v_negotiated,v_neg_status);';
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)'::regprocedure
  ) INTO STRICT definition;
  start_offset := position('  ELSIF v_type = ''replace'' THEN' IN definition);
  IF start_offset = 0 THEN RAISE EXCEPTION 'final cart replace branch is missing'; END IF;
  end_offset := position(E'\n  IF v_changed THEN' IN substring(definition FROM start_offset));
  IF end_offset = 0 THEN RAISE EXCEPTION 'final cart replace branch boundary is missing'; END IF;
  replace_block := substring(definition FROM start_offset FOR end_offset-1);
  IF position(normalized_status IN replace_block)>0 THEN
    IF (length(replace_block)-length(replace(replace_block,'AND w.negotiated IS NOT DISTINCT FROM v_negotiated','')))/length('AND w.negotiated IS NOT DISTINCT FROM v_negotiated') = 2
      AND (length(replace_block)-length(replace(replace_block,'AND w.neg_status IS NOT DISTINCT FROM v_neg_status','')))/length('AND w.neg_status IS NOT DISTINCT FROM v_neg_status') = 2
      AND (length(replace_block)-length(replace(replace_block,'AND w.negotiated IS NOT DISTINCT FROM l.negotiated_unit_price_minor','')))/length('AND w.negotiated IS NOT DISTINCT FROM l.negotiated_unit_price_minor') = 3
      AND (length(replace_block)-length(replace(replace_block,'AND w.neg_status IS NOT DISTINCT FROM l.negotiation_status','')))/length('AND w.neg_status IS NOT DISTINCT FROM l.negotiation_status') = 3 THEN RETURN; END IF;
    RAISE EXCEPTION 'normalized cart replace identity source is incomplete';
  END IF;
  IF (length(replace_block)-length(replace(replace_block,input_identity,'')))/length(input_identity) <> 2
    OR (length(replace_block)-length(replace(replace_block,stored_identity,'')))/length(stored_identity) <> 3
    OR (length(replace_block)-length(replace(replace_block,offer_check,'')))/length(offer_check) <> 1 THEN
    RAISE EXCEPTION 'final cart replace identity source does not match expected shape';
  END IF;
  -- Compute policy before staging/deduplication. An incoming accepted label
  -- never promotes a below-floor offer or bypasses product negotiability.
  repaired_block := replace(replace_block,offer_check,offer_check || E'\n      ' || normalized_status);
  repaired_block := replace(repaired_block,input_identity,input_identity || E'\n          AND w.negotiated IS NOT DISTINCT FROM v_negotiated\n          AND w.neg_status IS NOT DISTINCT FROM v_neg_status');
  repaired_block := replace(repaired_block,stored_identity,stored_identity || E'\n        AND w.negotiated IS NOT DISTINCT FROM l.negotiated_unit_price_minor\n        AND w.neg_status IS NOT DISTINCT FROM l.negotiation_status');
  EXECUTE overlay(definition PLACING repaired_block FROM start_offset FOR length(replace_block));
END $repair$;

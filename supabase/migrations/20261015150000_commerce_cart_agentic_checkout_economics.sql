-- Agentic items come from the reviewed snapshot; their economic inputs must
-- come from the same snapshot rather than an omitted or caller-supplied discount.
DO $repair$
DECLARE definition text; old text;
BEGIN
 definition:=pg_get_functiondef('public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)'::regprocedure);
 IF position('-- Reviewed agentic economics.' IN definition)>0 THEN RETURN; END IF;
 old:=$old$  v_hash := p_args ->> 'p_checkout_request_hash';$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'agentic binding economics source mismatch'; END IF;
 definition:=replace(definition,old,old || $new$

  -- Reviewed agentic economics.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_snapshot->'lines') line
      WHERE line->>'voucherToken' IS NOT NULL AND line->>'voucherAwardId' IS NOT NULL)
      AND p_variant IS DISTINCT FROM 'quiz_voucher' THEN
      RAISE EXCEPTION 'cart_order_voucher_authority_required' USING ERRCODE='P0001';
  END IF;
  IF v_items_derived THEN
    -- The authoritative financial leaf canonicalizes every order to exclusive.
    v_tax_basis:='exclusive';
    SELECT coalesce(sum(
      CASE WHEN line->>'voucherToken' IS NOT NULL AND line->>'voucherAwardId' IS NOT NULL THEN 0
      ELSE greatest((line->>'validatedUnitPriceMinor')::numeric-(line->>'effectiveUnitPriceMinor')::numeric,0)
        *(line->>'quantity')::numeric END),0)/100
    INTO v_discount FROM jsonb_array_elements(v_snapshot->'lines') line;
    v_expected:=greatest(0,
      (v_snapshot->'estimates'->>'subtotalMinor')::numeric/100
      +coalesce((SELECT sum(coalesce((item->>'assurance_fee')::numeric,0)) FROM jsonb_array_elements(v_items) item),0)
      +v_ship_fee+v_gift+CASE WHEN v_tax_basis='exclusive' THEN v_tax ELSE 0 END);
  END IF;$new$);
 EXECUTE definition;
END $repair$;

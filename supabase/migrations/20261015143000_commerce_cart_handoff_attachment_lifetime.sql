-- Match the shared merge planner: only bases with stored siblings use
-- attachment lanes. Lone differing attachments still require an explicit choice.
-- Patch the installed implementations so outer device/redaction guards survive.
DO $repair$
DECLARE definition text; old text; replacement text;
BEGIN
 definition := pg_get_functiondef('public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)'::regprocedure);
 IF position('v_attachment_lanes boolean' IN definition)>0 THEN RETURN; END IF;
 old := '  v_line_count integer;';
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff declaration source mismatch'; END IF;
 definition := replace(definition,old,old || E'\n  v_attachment_lanes boolean;\n  v_selected_quantity integer;');
 old := $old$    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_staged) s$old$;
 replacement := $new$    SELECT EXISTS (
      SELECT 1 FROM public.commerce_cart_lines l
      WHERE l.merchant_id=v_merchant AND l.cart_id IN (v_dest.id,v_incoming.id)
        AND l.product_id=v_product_id AND l.variant_id IS NOT DISTINCT FROM v_variant_id
        AND l.condition IS NOT DISTINCT FROM v_condition AND coalesce(l.options,'{}'::jsonb)=v_options
      GROUP BY l.cart_id HAVING count(*)>1
    ) INTO v_attachment_lanes;
    v_selected_quantity := NULL;
    IF v_line ? 'sourceLineId' AND (SELECT count(*) FROM jsonb_array_elements(p_lines) repeated WHERE repeated->>'sourceLineId'=v_line->>'sourceLineId')<>1 THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE='P0001';
    END IF;
    -- Preview retains opaque line IDs while redacting transferable attachments.
    -- Resolve that selector only within these locked carts and the parsed base.
    IF v_line ? 'sourceLineId' THEN
      SELECT l.voucher_token,l.voucher_award_id::text,l.negotiated_unit_price_minor,l.negotiation_status,l.quantity
      INTO v_voucher_token,v_voucher_award,v_negotiated,v_neg_status,v_selected_quantity
      FROM public.commerce_cart_lines l
      WHERE l.id::text=v_line->>'sourceLineId' AND l.merchant_id=v_merchant
        AND l.cart_id IN(v_dest.id,v_incoming.id) AND l.product_id=v_product_id
        AND l.variant_id IS NOT DISTINCT FROM v_variant_id AND l.condition IS NOT DISTINCT FROM v_condition
        AND coalesce(l.options,'{}'::jsonb)=v_options;
      IF NOT FOUND THEN RAISE EXCEPTION 'invalid_line' USING ERRCODE='P0001'; END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_staged) s$new$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff staging source mismatch'; END IF;
 definition := replace(definition,old,replacement);
 old := $old$        AND (s.value -> 'options') = v_options$old$;
 replacement := old || $new$
        AND (NOT v_attachment_lanes OR (
          (s.value ->> 'voucherToken') IS NOT DISTINCT FROM v_voucher_token
          AND (s.value ->> 'voucherAward') IS NOT DISTINCT FROM v_voucher_award
          AND (s.value ->> 'negotiated') IS NOT DISTINCT FROM v_negotiated::text
          AND (s.value ->> 'negStatus') IS NOT DISTINCT FROM v_neg_status))$new$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff duplicate identity source mismatch'; END IF;
 definition := replace(definition,old,replacement);
 old := $old$    ) THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_dest_line$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff alias source mismatch'; END IF;
 definition := replace(definition,old,$new$    ) THEN
      IF v_line ? 'sourceLineId' THEN CONTINUE; END IF;
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_dest_line$new$);
 old := $old$  IF v_line_count > 20 THEN$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff raw count source mismatch'; END IF;
 definition := replace(definition,old,$new$  IF v_line_count > 40 THEN$new$);
 old := $old$  FOR v_resolution IN SELECT value FROM jsonb_array_elements(coalesce(p_resolutions, '[]'::jsonb)) value LOOP
    IF NOT EXISTS ($old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff normalized count source mismatch'; END IF;
 definition := replace(definition,old,$new$  IF jsonb_array_length(v_staged)>20 THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE='P0001';
  END IF;
$new$ || old);
 old := $old$    IF v_quantity <> v_expected_qty THEN$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff quantity source mismatch'; END IF;
 definition := replace(definition,old,$new$    IF v_quantity <> v_expected_qty AND (v_selected_quantity IS NULL OR v_quantity <> v_selected_quantity) THEN$new$);
 old := $old$    v_staged := v_staged || jsonb_build_object($old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff canonical quantity source mismatch'; END IF;
 definition := replace(definition,old,
   $new$    v_quantity := v_expected_qty;
    v_staged := v_staged || jsonb_build_object($new$);
 old := $old$      v_assurance := v_dest_line.has_assurance;
      v_assurance_rate := v_dest_line.assurance_rate;
    ELSE$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff assurance source mismatch'; END IF;
 definition := replace(definition,old,$new$      v_assurance := v_dest_line.has_assurance OR coalesce(v_incoming_line.has_assurance,false);
      v_assurance_rate := coalesce(v_dest_line.assurance_rate,v_incoming_line.assurance_rate);
    ELSE$new$);
 old := $old$      AND coalesce(l.options, '{}'::jsonb) = v_options
    ORDER BY l.created_at LIMIT 1;$old$;
 replacement := $new$      AND coalesce(l.options, '{}'::jsonb) = v_options
      AND (NOT v_attachment_lanes OR (
        l.voucher_token IS NOT DISTINCT FROM v_voucher_token
        AND l.voucher_award_id::text IS NOT DISTINCT FROM v_voucher_award
        AND l.negotiated_unit_price_minor IS NOT DISTINCT FROM v_negotiated
        AND l.negotiation_status IS NOT DISTINCT FROM v_neg_status))
    ORDER BY l.created_at, l.id LIMIT 1;$new$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>2 THEN RAISE EXCEPTION 'handoff stored identity source mismatch'; END IF;
 definition := replace(definition,old,replacement);
 old := $old$expires_at=greatest(expires_at,now()+interval '7 days')$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>3 THEN RAISE EXCEPTION 'handoff renewal source mismatch'; END IF;
 definition := replace(definition,old,$new$expires_at=least(greatest(expires_at,now()+interval '7 days'),created_at+interval '7 days',v_incoming.created_at+interval '7 days')$new$);
 -- Connect renews an existing grant against both its own age and cart age.
 old := $old$SET expires_at = least(now() + interval '7 days', v_incoming.expires_at)$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff connect source mismatch'; END IF;
 definition := replace(definition,old,$new$SET expires_at = least(now() + interval '7 days', v_incoming.expires_at,
        v_incoming.created_at + interval '7 days', created_at + interval '7 days')$new$);
 -- A newly minted receiving grant must also respect the canonical cart deadline.
 old := $old$now()+interval '7 days',g.linked_customer_id,g.device_principal_id$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff receiving grant source mismatch'; END IF;
 definition := replace(definition,old,$new$least(now()+interval '7 days',v_incoming.created_at+interval '7 days'),g.linked_customer_id,g.device_principal_id$new$);
 old := $old$least(now() + interval '7 days', v_incoming.expires_at));$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff new connect grant source mismatch'; END IF;
 definition := replace(definition,old,
   $new$least(now() + interval '7 days', v_incoming.expires_at, v_incoming.created_at + interval '7 days'));$new$);
 EXECUTE definition;
END $repair$;

-- Tokens cannot outlive either the originating cart or its authorized grant.
-- Issuance replays retain their original expiry and never renew either row.
DO $repair$
DECLARE definition text; old text;
BEGIN
 definition := pg_get_functiondef('public.commerce_cart_issue_handoff_device_impl(text,uuid,uuid,text,jsonb)'::regprocedure);
 IF position('v_handoff_deadline timestamptz' IN definition)>0 THEN RETURN; END IF;
 old := '  v_cart_found boolean;';
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff issue declaration source mismatch'; END IF;
 definition := replace(definition,old,E'  v_cart_found boolean;\n  v_handoff_deadline timestamptz;');
 old := $old$  INSERT INTO public.commerce_cart_handoffs
    (id, handoff_hash, merchant_id, source_cart_id, origin_principal_id,$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff issue source mismatch'; END IF;
 definition := replace(definition,old,$new$  SELECT least(now()+interval '5 minutes',c.expires_at,c.created_at+interval '7 days',
      g.expires_at,g.created_at+interval '7 days') INTO v_handoff_deadline
  FROM public.commerce_carts c JOIN public.commerce_cart_grants g ON g.cart_id=c.id AND g.merchant_id=c.merchant_id
  WHERE c.id=p_cart_id AND c.merchant_id=v_merchant AND g.id=v_grant AND c.state='active';
  IF v_handoff_deadline IS NULL OR v_handoff_deadline<=now() THEN
    RETURN jsonb_build_object('ok',false,'code','expired','replayed',false);
  END IF;
$new$ || old);
 old := $old$p_operation_id, p_destination, now() + interval '5 minutes');$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff issue deadline source mismatch'; END IF;
 definition := replace(definition,old,
   $new$p_operation_id, p_destination, v_handoff_deadline);$new$);
 old := $old$to_char((now() + interval '5 minutes') AT TIME ZONE$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff issue receipt source mismatch'; END IF;
 definition := replace(definition,old,
   $new$to_char(v_handoff_deadline AT TIME ZONE$new$);
 EXECUTE definition;
END $repair$;

-- Preserve the outer lock/device/redaction wrapper, replacing its blanket
-- sibling refusal with complete, exact coverage of every stored sibling lane.
DO $repair$
DECLARE definition text; old text;
BEGIN
 definition:=pg_get_functiondef('public.commerce_cart_redeem_handoff(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)'::regprocedure);
 IF position('-- Exact sibling lane coverage.' IN definition)>0 THEN RETURN; END IF;
 old:=$old$   -- The versioned merge protocol has one context choice per identity. Do not
   -- silently drop multiple same-identity voucher lines within one source.
   IF EXISTS(SELECT 1 FROM public.commerce_cart_lines l WHERE l.merchant_id=merchant AND l.cart_id IN(handoff.source_cart_id,p_dest_cart_id)
     GROUP BY l.cart_id,l.product_id,l.variant_id,l.condition,l.options HAVING count(*)>1) THEN
    RETURN jsonb_build_object('ok',false,'code','merge_conflict','state',null,'replayed',false);
   END IF;$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'handoff sibling guard source mismatch'; END IF;
 definition:=replace(definition,old,$new$   -- Exact sibling lane coverage.
   IF EXISTS(SELECT 1 FROM public.commerce_cart_lines l
    WHERE l.merchant_id=merchant AND l.cart_id IN(handoff.source_cart_id,p_dest_cart_id)
    AND EXISTS(SELECT 1 FROM public.commerce_cart_lines sibling
      WHERE sibling.merchant_id=merchant AND sibling.cart_id IN(handoff.source_cart_id,p_dest_cart_id)
        AND sibling.product_id=l.product_id AND sibling.variant_id IS NOT DISTINCT FROM l.variant_id
        AND sibling.condition IS NOT DISTINCT FROM l.condition AND sibling.options=l.options
      GROUP BY sibling.cart_id HAVING count(*)>1)
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) line
      CROSS JOIN LATERAL public.commerce_cart_parse_input_line(line) parsed
      WHERE parsed.pi_product=l.product_id AND parsed.pi_variant IS NOT DISTINCT FROM l.variant_id
        AND parsed.pi_condition IS NOT DISTINCT FROM l.condition AND parsed.pi_options=coalesce(l.options,'{}'::jsonb)
        AND ((NOT (line ? 'sourceLineId')
          AND parsed.pi_voucher_token IS NOT DISTINCT FROM l.voucher_token
          AND parsed.pi_voucher_award IS NOT DISTINCT FROM l.voucher_award_id::text
          AND parsed.pi_negotiated IS NOT DISTINCT FROM l.negotiated_unit_price_minor
          AND parsed.pi_neg_status IS NOT DISTINCT FROM l.negotiation_status)
        OR EXISTS(SELECT 1 FROM public.commerce_cart_lines selected
          WHERE selected.id::text=line->>'sourceLineId' AND selected.merchant_id=merchant
            AND selected.cart_id IN(handoff.source_cart_id,p_dest_cart_id)
            AND selected.product_id=l.product_id AND selected.variant_id IS NOT DISTINCT FROM l.variant_id
            AND selected.condition IS NOT DISTINCT FROM l.condition AND selected.options=l.options
            AND selected.voucher_token IS NOT DISTINCT FROM l.voucher_token
            AND selected.voucher_award_id IS NOT DISTINCT FROM l.voucher_award_id
            AND selected.negotiated_unit_price_minor IS NOT DISTINCT FROM l.negotiated_unit_price_minor
            AND selected.negotiation_status IS NOT DISTINCT FROM l.negotiation_status)))) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_item','state',null,'replayed',false);
   END IF;$new$);
 EXECUTE definition;
END $repair$;

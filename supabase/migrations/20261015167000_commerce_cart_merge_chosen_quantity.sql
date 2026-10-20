-- Align the handoff redemption RPC with the shared merge planner's
-- chosen-quantity rule: when stored attachments conflict and the
-- shopper resolves the conflict, the submitted quantity must be the
-- chosen side's quantity, not the maximum of both sides. The maximum
-- still applies when attachments are equal, when only one side has
-- the line, and while a conflict is unresolved (the staged line is
-- then rejected by the conflict response, as before).
DO $repair$
DECLARE definition text; old text;
BEGIN
  definition := pg_get_functiondef('public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)'::regprocedure);
  IF position('v_keep = ''incoming'' THEN v_incoming_line.quantity' IN definition) > 0 THEN
    RETURN;
  END IF;
  old := $old$      v_expected_qty := greatest(coalesce(v_dest_line.quantity, 0), coalesce(v_incoming_line.quantity, 0));$old$;
  IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'handoff chosen-quantity source mismatch';
  END IF;
  definition := replace(definition, old,
    $new$      v_expected_qty := CASE
        WHEN v_dest_found AND v_incoming_found
          AND (v_dest_line.voucher_token IS DISTINCT FROM v_incoming_line.voucher_token
            OR v_dest_line.voucher_award_id::text IS DISTINCT FROM v_incoming_line.voucher_award_id::text
            OR v_dest_line.negotiated_unit_price_minor IS DISTINCT FROM v_incoming_line.negotiated_unit_price_minor
            OR v_dest_line.negotiation_status IS DISTINCT FROM v_incoming_line.negotiation_status)
          AND v_keep = 'incoming' THEN v_incoming_line.quantity
        WHEN v_dest_found AND v_incoming_found
          AND (v_dest_line.voucher_token IS DISTINCT FROM v_incoming_line.voucher_token
            OR v_dest_line.voucher_award_id::text IS DISTINCT FROM v_incoming_line.voucher_award_id::text
            OR v_dest_line.negotiated_unit_price_minor IS DISTINCT FROM v_incoming_line.negotiated_unit_price_minor
            OR v_dest_line.negotiation_status IS DISTINCT FROM v_incoming_line.negotiation_status)
          AND v_keep = 'existing' THEN v_dest_line.quantity
        ELSE greatest(coalesce(v_dest_line.quantity, 0), coalesce(v_incoming_line.quantity, 0))
      END;$new$);
  old := $old$    IF v_quantity <> v_expected_qty AND (v_selected_quantity IS NULL OR v_quantity <> v_selected_quantity) THEN$old$;
  IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'handoff chosen-quantity check source mismatch';
  END IF;
  -- An unresolved conflict probe may carry either side's quantity:
  -- it must still reach the merge_conflict response instead of being
  -- rejected as an invalid line. Resolved and equal-attachment lines
  -- keep the strict expected-quantity check above.
  definition := replace(definition, old,
    $new$    IF v_quantity <> v_expected_qty AND (v_selected_quantity IS NULL OR v_quantity <> v_selected_quantity)
      AND NOT (
        v_dest_found AND v_incoming_found
        AND (v_dest_line.voucher_token IS DISTINCT FROM v_incoming_line.voucher_token
          OR v_dest_line.voucher_award_id::text IS DISTINCT FROM v_incoming_line.voucher_award_id::text
          OR v_dest_line.negotiated_unit_price_minor IS DISTINCT FROM v_incoming_line.negotiated_unit_price_minor
          OR v_dest_line.negotiation_status IS DISTINCT FROM v_incoming_line.negotiation_status)
        AND v_keep IS NULL
        AND v_quantity IN (v_dest_line.quantity, v_incoming_line.quantity)
      ) THEN$new$);
  EXECUTE definition;
END $repair$;

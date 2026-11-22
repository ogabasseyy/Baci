-- A fresh MCP link can reopen the prior import for the same website owner.
-- The original destination grant must still be live. Replay copies no lines.
DO $migration$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)'::regprocedure
  );
  old_branch constant text := $body$  IF handoff.redeemed_at IS NOT NULL THEN
    IF handoff.redemption_receipt->>'choice' IS DISTINCT FROM 'import_mcp'
       OR handoff.redemption_receipt->>'principalId' IS DISTINCT FROM principal
       OR (scope = 'session' AND (
         handoff.redemption_receipt->>'destCartId' IS DISTINCT FROM destination_id::text
         OR handoff.redemption_receipt->>'destGrantId' IS DISTINCT FROM destination_grant::text))
    THEN RETURN jsonb_build_object('ok', false, 'code', 'handoff_consumed'); END IF;
    destination_id := (handoff.redemption_receipt->>'destCartId')::uuid;
    destination_grant := (handoff.redemption_receipt->>'destGrantId')::uuid;
    replayed := true;
  ELSIF handoff.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

$body$;
  new_branch constant text := $body$  IF handoff.redeemed_at IS NULL THEN
    IF handoff.expires_at <= now() THEN
      RETURN jsonb_build_object('ok', false, 'code', 'expired');
    END IF;
    -- The source/principal lock makes this lookup atomic with import.
    SELECT h.redemption_receipt INTO handoff.redemption_receipt
    FROM public.commerce_cart_handoffs h
    WHERE h.merchant_id = merchant AND h.source_cart_id = handoff.source_cart_id
      AND h.redeemed_at IS NOT NULL AND h.redemption_receipt->>'choice' = 'import_mcp'
      AND h.redemption_receipt->>'principalId' = principal
    ORDER BY h.redeemed_at, h.id LIMIT 1;
  END IF;
  IF handoff.redeemed_at IS NOT NULL OR handoff.redemption_receipt IS NOT NULL THEN
    IF handoff.redemption_receipt->>'choice' IS DISTINCT FROM 'import_mcp'
       OR handoff.redemption_receipt->>'principalId' IS DISTINCT FROM principal
       OR (scope = 'session' AND (
         handoff.redemption_receipt->>'destCartId' IS DISTINCT FROM destination_id::text
         OR handoff.redemption_receipt->>'destGrantId' IS DISTINCT FROM destination_grant::text))
    THEN RETURN jsonb_build_object('ok', false, 'code', 'handoff_consumed'); END IF;
    destination_id := (handoff.redemption_receipt->>'destCartId')::uuid;
    destination_grant := (handoff.redemption_receipt->>'destGrantId')::uuid;
    replayed := true;
  END IF;

$body$;
  old_replay constant text := $body$  IF replayed OR destination_id = handoff.source_cart_id THEN
$body$;
  new_replay constant text := $body$  IF replayed OR destination_id = handoff.source_cart_id THEN
    -- Bootstrap proof issuance assumes the full session vocabulary.
    IF replayed AND scope = 'bootstrap' AND NOT EXISTS (
      SELECT 1 FROM public.commerce_cart_grants g WHERE g.id = destination_grant
        AND ARRAY['add','set_quantity','remove','clear','replace','set_assurance','set_negotiated_price']
          <@ g.allowed_operations
    ) THEN RETURN jsonb_build_object('ok', false, 'code', 'unauthorized'); END IF;
    IF replayed AND handoff.redeemed_at IS NULL THEN
      -- Record the refreshed alias after checking the original destination grant.
      UPDATE public.commerce_cart_handoffs SET redeemed_at = now(),
        destination_attempt_id = p_attempt_id, redemption_receipt = handoff.redemption_receipt
      WHERE id = handoff.id;
    END IF;
$body$;
  old_guard constant text := $body$  IF EXISTS (
    SELECT 1 FROM public.commerce_cart_handoffs h WHERE h.merchant_id = merchant
      AND h.source_cart_id = source.id AND h.redemption_receipt->>'choice' = 'import_mcp'
      AND h.redemption_receipt->>'principalId' = principal
  ) THEN RETURN jsonb_build_object('ok', false, 'code', 'handoff_consumed'); END IF;

$body$;
BEGIN
  IF position(old_branch IN definition) = 0 OR position(old_replay IN definition) = 0
     OR position(old_guard IN definition) = 0 THEN
    RAISE EXCEPTION 'MCP cart import refresh replay source mismatch';
  END IF;
  definition := replace(definition, old_branch, new_branch);
  definition := replace(definition, old_replay, new_replay);
  EXECUTE replace(definition, old_guard, '');
END $migration$;

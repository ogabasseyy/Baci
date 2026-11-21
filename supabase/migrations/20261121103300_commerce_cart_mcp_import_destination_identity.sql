-- Imported quantities belong to the destination cart across grant changes.
ALTER TABLE private.commerce_cart_mcp_imports
  DROP CONSTRAINT commerce_cart_mcp_imports_pkey,
  ADD PRIMARY KEY (merchant_id, source_cart_id, destination_cart_id);
CREATE INDEX commerce_cart_mcp_imports_bootstrap_idx
  ON private.commerce_cart_mcp_imports (merchant_id, source_cart_id, principal_id);

DO $migration$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)'::regprocedure
  );
  old_lock constant text := $body$  -- Serialize imports from the same source to the same website identity,
  -- even when two different continuation links were issued.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'cc-mcp-import|' || merchant || '|' || handoff.source_cart_id || '|' || principal, 0
  ));$body$;
  new_lock constant text := $body$  -- Different verified grants may address the same destination cart.
  -- Serialize before looking up its import baseline.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'cc-mcp-import|' || merchant || '|' || handoff.source_cart_id, 0
  ));$body$;
  old_lookup constant text := $body$    SELECT i.* INTO prior_import
    FROM private.commerce_cart_mcp_imports i
    WHERE i.merchant_id = merchant AND i.source_cart_id = handoff.source_cart_id
      AND i.principal_id = principal;
    IF FOUND THEN
      IF scope = 'session' AND (
        prior_import.destination_cart_id IS DISTINCT FROM destination_id
        OR prior_import.destination_grant_id IS DISTINCT FROM destination_grant
      ) THEN RETURN jsonb_build_object('ok', false, 'code', 'handoff_consumed'); END IF;
      destination_id := prior_import.destination_cart_id;
      destination_grant := prior_import.destination_grant_id;
    ELSIF EXISTS (
      -- An older receipt cannot establish the quantities already copied.
      SELECT 1 FROM public.commerce_cart_handoffs h
      WHERE h.merchant_id = merchant AND h.source_cart_id = handoff.source_cart_id
        AND h.redemption_receipt->>'choice' = 'import_mcp'
        AND h.redemption_receipt->>'principalId' = principal
    ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'handoff_consumed');
    END IF;$body$;
  new_lookup constant text := $body$    SELECT i.* INTO prior_import
    FROM private.commerce_cart_mcp_imports i
    WHERE i.merchant_id = merchant AND i.source_cart_id = handoff.source_cart_id
      AND ((scope = 'session' AND i.destination_cart_id = destination_id)
        OR (scope = 'bootstrap' AND i.principal_id = principal AND NOT EXISTS (
          SELECT 1 FROM private.commerce_cart_mcp_imports other
          WHERE other.merchant_id = merchant AND other.source_cart_id = handoff.source_cart_id
            AND other.principal_id = principal
            AND other.destination_cart_id <> i.destination_cart_id
        )));
    IF FOUND THEN
      IF scope = 'bootstrap' THEN
        destination_id := prior_import.destination_cart_id;
        destination_grant := prior_import.destination_grant_id;
      END IF;
    ELSIF EXISTS (
      -- Older receipts have no canonical line baseline.
      SELECT 1 FROM public.commerce_cart_handoffs h
      WHERE h.merchant_id = merchant AND h.source_cart_id = handoff.source_cart_id
        AND h.redemption_receipt->>'choice' = 'import_mcp'
        AND ((scope = 'session' AND h.redemption_receipt->>'destCartId' = destination_id::text)
          OR (scope = 'bootstrap' AND h.redemption_receipt->>'principalId' = principal))
    ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'handoff_consumed');
    END IF;$body$;
  old_resume constant text := $body$    IF scope = 'bootstrap' AND copy_lines IS NOT NULL
    THEN RETURN jsonb_build_object('ok', false, 'code', 'unauthorized'); END IF;$body$;
  new_resume constant text := $body$    IF scope = 'bootstrap' AND copy_lines IS NOT NULL THEN
      -- Recover the authenticated destination first. The browser retries
      -- the same pending link with that session; no cart lines change here.
      RETURN jsonb_build_object('ok', true, 'choice', 'import_mcp', 'replayed', true,
        'resumeImport', true, 'state', public.commerce_cart_assemble_state(merchant, destination_id),
        'grantId', destination_grant, 'grantExpiresAt', grant_expiry);
    END IF;$body$;
  old_upsert constant text := $body$ON CONFLICT (merchant_id, source_cart_id, principal_id)$body$;
  new_upsert constant text := $body$ON CONFLICT (merchant_id, source_cart_id, destination_cart_id)$body$;
BEGIN
  IF position(old_lock IN definition) = 0 OR position(old_lookup IN definition) = 0
     OR position(old_resume IN definition) = 0 OR position(old_upsert IN definition) = 0 THEN
    RAISE EXCEPTION 'MCP import destination identity source mismatch';
  END IF;
  definition := replace(definition, old_lock, new_lock);
  definition := replace(definition, old_lookup, new_lookup);
  definition := replace(definition, old_resume, new_resume);
  EXECUTE replace(definition, old_upsert, new_upsert);
END $migration$;

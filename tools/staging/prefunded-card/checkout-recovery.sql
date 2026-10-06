BEGIN;

CREATE FUNCTION prefunded_card.checkout_recovery_candidates(
  p_scope jsonb,p_after jsonb,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE; result jsonb;
DECLARE cursor_created_at timestamptz; cursor_intent_id uuid; cursor_value jsonb;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_authorizer');
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'first-card checkout recovery limit denied' USING ERRCODE='22023';
  END IF;
  IF p_after IS NOT NULL AND p_after<>'null'::jsonb THEN
    IF jsonb_typeof(p_after)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_after))<>2
      OR NOT p_after ?& ARRAY['createdAt','intentId']
      OR jsonb_typeof(p_after->'createdAt')<>'string' OR jsonb_typeof(p_after->'intentId')<>'string'
      OR p_after->>'createdAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
      OR p_after->>'intentId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'first-card checkout recovery cursor denied' USING ERRCODE='22023';
    END IF;
    cursor_created_at:=(p_after->>'createdAt')::timestamptz;
    cursor_intent_id:=(p_after->>'intentId')::uuid;
    IF prefunded_card.checkout_utc_iso(cursor_created_at) IS DISTINCT FROM p_after->>'createdAt' THEN
      RAISE EXCEPTION 'first-card checkout recovery cursor denied' USING ERRCODE='22023';
    END IF;
  END IF;

  result:=jsonb_build_object('candidates','[]'::jsonb,'nextCursor',p_after);
  FOR intent IN
    SELECT stored.*
    FROM prefunded_card.checkout_intents stored
    JOIN prefunded_card.treasury_bindings binding ON binding.id=stored.treasury_binding_id
    WHERE stored.deployment='staging'
      AND stored.integration_id=(p_scope->>'integrationId')::uuid
      AND stored.merchant_id=(p_scope->>'merchantId')::uuid
      AND stored.treasury_binding_id=(p_scope->>'treasuryBindingId')::uuid
      AND stored.business_id=p_scope->>'businessId'
      AND stored.system_identifier=p_scope->>'systemIdentifier'
      AND stored.expires_at='2026-09-29T15:59:10Z'::timestamptz
      AND stored.database_name=current_database()
      AND stored.phase IN ('initializing','ready','pending')
      AND binding.integration_id=stored.integration_id
      AND binding.merchant_id=stored.merchant_id
      AND binding.expected_business_id=stored.business_id
      AND binding.authorized_login=stored.authorized_login
      AND binding.currency='NGN'
    ORDER BY CASE
        WHEN cursor_created_at IS NULL OR (date_trunc('milliseconds',stored.created_at),stored.id)>(cursor_created_at,cursor_intent_id) THEN 0
        ELSE 1
      END,
      date_trunc('milliseconds',stored.created_at),stored.id
    LIMIT p_limit
  LOOP
    cursor_value:=jsonb_build_object(
      'createdAt',prefunded_card.checkout_utc_iso(intent.created_at),
      'intentId',intent.id
    );
    result:=jsonb_set(
      result,
      '{candidates}',
      (result->'candidates') || jsonb_build_array(jsonb_build_object(
        'cursor',cursor_value,
        'intent',prefunded_card.checkout_intent_json(intent)
      ))
    );
    result:=jsonb_set(result,'{nextCursor}',cursor_value);
  END LOOP;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)
  FROM PUBLIC,anon,authenticated,service_role,prefunded_treasury_operator,prefunded_authorizer;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='prefunded_evidence') THEN
    REVOKE ALL ON FUNCTION prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)
      FROM prefunded_evidence;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)
  TO prefunded_authorizer;

COMMENT ON FUNCTION prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer) IS
  'Authorizer-only bounded circular read of unresolved staging first-card intents; it performs no provider, reservation, transfer, or credit action.';

COMMIT;

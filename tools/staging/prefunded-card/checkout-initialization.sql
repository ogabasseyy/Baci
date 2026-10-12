BEGIN;

CREATE FUNCTION prefunded_card.checkout_validate_initialization_claim(
  intent prefunded_card.checkout_intents,p_claim jsonb,p_require_live_lease boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_claim IS NULL OR jsonb_typeof(p_claim)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_claim))<>5
    OR NOT p_claim ?& ARRAY['outcome','intent','token','fence','leaseExpiresAt']
    OR jsonb_typeof(p_claim->'outcome')<>'string' OR jsonb_typeof(p_claim->'intent')<>'object'
    OR jsonb_typeof(p_claim->'token')<>'string' OR jsonb_typeof(p_claim->'fence')<>'number'
    OR jsonb_typeof(p_claim->'leaseExpiresAt')<>'string' THEN
    RAISE EXCEPTION 'first-card checkout initialization claim denied' USING ERRCODE='42501';
  END IF;
  IF p_claim->>'outcome' IS DISTINCT FROM 'claimed'
    OR p_claim->'intent' IS DISTINCT FROM prefunded_card.checkout_intent_json(intent)
    OR p_claim->>'token' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_claim->>'fence' !~ '^[1-9][0-9]{0,15}$' THEN
    RAISE EXCEPTION 'first-card checkout initialization claim denied' USING ERRCODE='42501';
  END IF;
  IF intent.initialization_token IS DISTINCT FROM (p_claim->>'token')::uuid
    OR intent.initialization_fence IS DISTINCT FROM (p_claim->>'fence')::bigint
    OR p_claim->>'leaseExpiresAt' IS DISTINCT FROM prefunded_card.checkout_utc_iso(intent.initialization_lease_expires_at)
    OR (p_require_live_lease AND (intent.initialization_lease_expires_at IS NULL
      OR intent.initialization_lease_expires_at<=clock_timestamp())) THEN
    RAISE EXCEPTION 'first-card checkout initialization claim denied' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION prefunded_card.checkout_read(p_scope jsonb,p_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_treasury_operator');
  intent:=prefunded_card.checkout_lock_intent(p_scope,p_selection,false,true);
  RETURN prefunded_card.checkout_snapshot(intent);
END $$;

CREATE FUNCTION prefunded_card.checkout_claim_initialization(p_scope jsonb,p_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE; token uuid;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_authorizer');
  intent:=prefunded_card.checkout_lock_intent(p_scope,p_selection,true,false);
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=intent.treasury_binding_id FOR SHARE;
  IF NOT FOUND OR binding.integration_id IS DISTINCT FROM intent.integration_id
    OR binding.merchant_id IS DISTINCT FROM intent.merchant_id
    OR binding.expected_business_id IS DISTINCT FROM intent.business_id
    OR binding.authorized_login IS DISTINCT FROM intent.authorized_login
    OR NOT prefunded_card.treasury_reservation_ready(binding.id) THEN
    RAISE EXCEPTION 'first-card checkout initialization denied' USING ERRCODE='42501';
  END IF;
  IF intent.phase<>'reserved' THEN
    RETURN jsonb_build_object('outcome','existing','snapshot',prefunded_card.checkout_snapshot(intent));
  END IF;
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  token:=gen_random_uuid();
  UPDATE prefunded_card.checkout_intents SET phase='initializing',initialization_fence=initialization_fence+1,
    initialization_token=token,initialization_lease_expires_at=least(
      clock_timestamp()+interval '120 seconds','2026-09-29T15:59:10Z'::timestamptz
    ) WHERE id=intent.id;
  SELECT * INTO intent FROM prefunded_card.checkout_intents WHERE id=intent.id;
  RETURN jsonb_build_object('outcome','claimed','intent',prefunded_card.checkout_intent_json(intent),
    'token',token,'fence',intent.initialization_fence,
    'leaseExpiresAt',prefunded_card.checkout_utc_iso(intent.initialization_lease_expires_at));
END $$;

CREATE FUNCTION prefunded_card.checkout_validate_session(
  intent prefunded_card.checkout_intents,p_session jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF intent.phase IS DISTINCT FROM 'initializing' OR p_session IS NULL OR jsonb_typeof(p_session)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_session))<>2 OR NOT p_session ?& ARRAY['reference','authorizationUrl']
    OR jsonb_typeof(p_session->'reference')<>'string' OR jsonb_typeof(p_session->'authorizationUrl')<>'string'
    OR p_session->>'reference' IS DISTINCT FROM intent.reference
    OR octet_length(p_session->>'authorizationUrl')>512
    OR p_session->>'authorizationUrl' !~ '^https://checkout\.paystack\.com/[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'first-card checkout session denied' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION prefunded_card.checkout_complete_initialization(
  p_scope jsonb,p_selection jsonb,p_claim jsonb,p_session jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_authorizer');
  intent:=prefunded_card.checkout_lock_intent(p_scope,p_selection,true,false);
  PERFORM prefunded_card.checkout_validate_initialization_claim(intent,p_claim,true);
  PERFORM prefunded_card.checkout_validate_session(intent,p_session);
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  UPDATE prefunded_card.checkout_intents SET phase='ready',session_reference=intent.reference,
    session_authorization_url=p_session->>'authorizationUrl',initialization_token=NULL,initialization_lease_expires_at=NULL
    WHERE id=intent.id;
  SELECT * INTO intent FROM prefunded_card.checkout_intents WHERE id=intent.id;
  RETURN prefunded_card.checkout_snapshot(intent);
END $$;

CREATE FUNCTION prefunded_card.checkout_mark_initialization_uncertain(
  p_scope jsonb,p_selection jsonb,p_claim jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_authorizer');
  intent:=prefunded_card.checkout_lock_intent(p_scope,p_selection,false,false);
  PERFORM prefunded_card.checkout_validate_initialization_claim(intent,p_claim,false);
  IF intent.phase<>'initializing' THEN
    RAISE EXCEPTION 'first-card checkout uncertainty denied' USING ERRCODE='42501';
  END IF;
  UPDATE prefunded_card.checkout_intents SET phase='pending',initialization_token=NULL,
    initialization_lease_expires_at=NULL WHERE id=intent.id;
  RETURN 'true'::jsonb;
END $$;

REVOKE ALL ON FUNCTION prefunded_card.checkout_validate_initialization_claim(prefunded_card.checkout_intents,jsonb,boolean),
  prefunded_card.checkout_validate_session(prefunded_card.checkout_intents,jsonb),
  prefunded_card.checkout_read(jsonb,jsonb),prefunded_card.checkout_claim_initialization(jsonb,jsonb),
  prefunded_card.checkout_complete_initialization(jsonb,jsonb,jsonb,jsonb),
  prefunded_card.checkout_mark_initialization_uncertain(jsonb,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;

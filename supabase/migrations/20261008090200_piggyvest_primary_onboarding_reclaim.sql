BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.claim_onboarding(scope jsonb, fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  intent piggyvest_primary.onboarding_intents%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  IF fingerprint IS NULL OR fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid onboarding fingerprint' USING ERRCODE = '22023';
  END IF;
  INSERT INTO piggyvest_primary.onboarding_intents(integration_id, merchant_id, customer_id, user_id, request_fingerprint, state, claim_token)
  VALUES ((scope->>'integrationId')::uuid, (scope->>'merchantId')::uuid, (scope->>'customerId')::uuid,
    (scope->>'userId')::uuid, fingerprint, 'dispatched', pg_catalog.gen_random_uuid())
  ON CONFLICT(integration_id, customer_id) DO NOTHING RETURNING * INTO intent;
  IF FOUND THEN
    RETURN jsonb_build_object('status','claimed','intentId',intent.id,'claimToken',intent.claim_token,'reclaimed',false);
  END IF;
  SELECT * INTO STRICT intent FROM piggyvest_primary.onboarding_intents
    WHERE integration_id = (scope->>'integrationId')::uuid AND customer_id = (scope->>'customerId')::uuid FOR UPDATE;
  IF intent.user_id <> (scope->>'userId')::uuid OR intent.request_fingerprint <> fingerprint THEN
    RETURN jsonb_build_object('status','conflict');
  END IF;
  IF intent.state = 'unknown' THEN
    UPDATE piggyvest_primary.onboarding_intents SET state = 'dispatched', claim_token = pg_catalog.gen_random_uuid(),
      updated_at = pg_catalog.clock_timestamp() WHERE id = intent.id RETURNING * INTO intent;
    RETURN jsonb_build_object('status','claimed','intentId',intent.id,'claimToken',intent.claim_token,'reclaimed',true);
  END IF;
  RETURN jsonb_build_object('status', CASE WHEN intent.state = 'verified' THEN 'ready' ELSE 'pending' END);
END $$;
COMMIT;

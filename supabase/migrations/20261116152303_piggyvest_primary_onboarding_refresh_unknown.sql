-- Let a customer retry onboarding with corrected details once PiggyVest
-- itself proves the earlier attempt created nothing.
--
-- claim_onboarding locks an intent to its first request fingerprint, so an
-- intent left 'unknown' by a failed dispatch (for example a rejected API key)
-- answers 'conflict' to any retry whose BVN, name, phone or email differs,
-- forever. That refusal is deliberate and stays: the earlier dispatch may
-- have created a PiggyVest customer under the old identity, and adopting it
-- under new details would bind a wallet to the wrong BVN.
--
-- The executor calls this function only after PiggyVest's customer listing
-- for this account's third_party_identifier (baci:<integration>:<customer>,
-- not BVN-based) returned a complete, empty answer. It re-fingerprints the
-- intent and claims it fresh (reclaimed:false) only while the intent still
-- holds no provider ids, carries no review evidence, belongs to the same
-- user, and is 'unknown' or a dispatch whose 5-minute lease has expired.
-- Every other state keeps answering 'conflict' for review.
BEGIN;
ALTER TABLE piggyvest_primary.onboarding_intents
  ADD COLUMN IF NOT EXISTS identity_refreshed boolean NOT NULL DEFAULT false;

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
  IF intent.state = 'unknown' OR (intent.state = 'dispatched' AND intent.updated_at < pg_catalog.clock_timestamp() - interval '5 minutes') THEN
    UPDATE piggyvest_primary.onboarding_intents SET state = 'dispatched', claim_token = pg_catalog.gen_random_uuid(),
      updated_at = pg_catalog.clock_timestamp() WHERE id = intent.id RETURNING * INTO intent;
    -- identityRefreshed is sent only when true: the previous app release
    -- parses this answer strictly, so an always-present key would break
    -- ordinary reclaims during a migration-first rollout or a rollback.
    RETURN jsonb_build_object(
      'status','claimed',
      'intentId',intent.id,
      'claimToken',intent.claim_token,
      'reclaimed', true
    ) || CASE WHEN intent.identity_refreshed
      THEN jsonb_build_object('identityRefreshed', true)
      ELSE '{}'::jsonb END;
  END IF;
  RETURN jsonb_build_object('status', CASE WHEN intent.state = 'verified' THEN 'ready' WHEN intent.state = 'rejected' THEN 'conflict' ELSE 'pending' END);
END $$;

CREATE FUNCTION piggyvest_primary.refresh_unknown_onboarding(scope jsonb, fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  intent piggyvest_primary.onboarding_intents%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  IF fingerprint IS NULL OR fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid onboarding fingerprint' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO intent FROM piggyvest_primary.onboarding_intents
    WHERE integration_id = (scope->>'integrationId')::uuid
      AND customer_id = (scope->>'customerId')::uuid
    FOR UPDATE;
  IF NOT FOUND
    OR intent.merchant_id <> (scope->>'merchantId')::uuid
    OR intent.user_id <> (scope->>'userId')::uuid
    OR intent.request_fingerprint = fingerprint
    -- One refresh only: a second would dispatch yet another BVN while every
    -- earlier request may still land, and the intent keeps one customer pair.
    OR intent.identity_refreshed
    OR intent.provider_customer_id IS NOT NULL
    OR intent.provider_wallet_id IS NOT NULL
    OR intent.review_reason IS NOT NULL
    OR NOT (intent.state = 'unknown'
      OR (intent.state = 'dispatched'
        AND intent.updated_at < pg_catalog.clock_timestamp() - interval '5 minutes')) THEN
    RETURN jsonb_build_object('status', 'conflict');
  END IF;
  UPDATE piggyvest_primary.onboarding_intents SET
    request_fingerprint = fingerprint, identity_refreshed = true, state = 'dispatched',
    claim_token = pg_catalog.gen_random_uuid(), updated_at = pg_catalog.clock_timestamp()
  WHERE id = intent.id RETURNING * INTO intent;
  RETURN jsonb_build_object('status', 'claimed', 'intentId', intent.id,
    'claimToken', intent.claim_token, 'reclaimed', false, 'identityRefreshed', true);
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.claim_onboarding(jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.claim_onboarding(jsonb, text)
  TO piggyvest_primary_provisioner;
REVOKE ALL ON FUNCTION piggyvest_primary.refresh_unknown_onboarding(jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.refresh_unknown_onboarding(jsonb, text)
  TO piggyvest_primary_provisioner;
COMMIT;

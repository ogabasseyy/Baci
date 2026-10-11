BEGIN;
-- An explicit existing-customer response (new_customer=false) is an
-- ownership verdict, not transport ambiguity: recording it as 'unknown'
-- lets the next identical request reclaim the intent and adopt the
-- unrelated provider wallet, bypassing ownership review. Record such
-- rejections in a terminal 'rejected' state that claim_onboarding never
-- reclaims; retries report 'conflict' so the owner reviews instead of
-- the retry silently binding a stranger's wallet. Transport-ambiguous
-- outcomes (unparseable responses, thrown requests) keep recording
-- 'unknown' and stay reclaimable.
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT constraint_entry.conname INTO constraint_name
  FROM pg_catalog.pg_constraint constraint_entry
  JOIN pg_catalog.pg_class constrained
    ON constrained.oid = constraint_entry.conrelid
  JOIN pg_catalog.pg_namespace constrained_schema
    ON constrained_schema.oid = constrained.relnamespace
  WHERE constraint_entry.contype = 'c'
    AND constrained_schema.nspname = 'piggyvest_primary'
    AND constrained.relname = 'onboarding_intents'
    AND pg_catalog.pg_get_constraintdef(constraint_entry.oid) LIKE '%dispatched%accepted%unknown%verified%';
  IF constraint_name IS NULL THEN
    RAISE EXCEPTION 'missing onboarding intent state check';
  END IF;
  EXECUTE format(
    'ALTER TABLE piggyvest_primary.onboarding_intents DROP CONSTRAINT %I, ADD CHECK (state IN (''dispatched'', ''accepted'', ''unknown'', ''verified'', ''rejected''))',
    constraint_name
  );
  SELECT constraint_entry.conname INTO constraint_name
  FROM pg_catalog.pg_constraint constraint_entry
  JOIN pg_catalog.pg_class constrained
    ON constrained.oid = constraint_entry.conrelid
  JOIN pg_catalog.pg_namespace constrained_schema
    ON constrained_schema.oid = constrained.relnamespace
  WHERE constraint_entry.contype = 'c'
    AND constrained_schema.nspname = 'piggyvest_primary'
    AND constrained.relname = 'onboarding_intents'
    AND pg_catalog.pg_get_constraintdef(constraint_entry.oid) LIKE '%claim_token IS NOT NULL%';
  IF constraint_name IS NULL THEN
    RAISE EXCEPTION 'missing onboarding intent coherence check';
  END IF;
  EXECUTE format(
    'ALTER TABLE piggyvest_primary.onboarding_intents DROP CONSTRAINT %I, ADD CHECK ((state = ''dispatched'' AND claim_token IS NOT NULL AND provider_customer_id IS NULL AND provider_wallet_id IS NULL)'
    ' OR (state = ''unknown'' AND claim_token IS NULL AND provider_customer_id IS NULL AND provider_wallet_id IS NULL)'
    ' OR (state = ''rejected'' AND claim_token IS NULL AND provider_customer_id IS NULL AND provider_wallet_id IS NULL)'
    ' OR (state IN (''accepted'', ''verified'') AND claim_token IS NULL AND provider_customer_id IS NOT NULL AND provider_wallet_id IS NOT NULL))',
    constraint_name
  );
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary.record_onboarding_rejection(scope jsonb, intent_id uuid, token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  UPDATE piggyvest_primary.onboarding_intents SET
    state = 'rejected', claim_token = NULL,
    provider_customer_id = NULL, provider_wallet_id = NULL,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = intent_id AND integration_id = (scope->>'integrationId')::uuid
    AND merchant_id = (scope->>'merchantId')::uuid AND customer_id = (scope->>'customerId')::uuid
    AND user_id = (scope->>'userId')::uuid AND state = 'dispatched' AND claim_token = token;
  RETURN FOUND;
END $$;
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
    RETURN jsonb_build_object('status','claimed','intentId',intent.id,'claimToken',intent.claim_token,'reclaimed',true);
  END IF;
  RETURN jsonb_build_object('status', CASE WHEN intent.state = 'verified' THEN 'ready' WHEN intent.state = 'rejected' THEN 'conflict' ELSE 'pending' END);
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.record_onboarding_rejection(jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.record_onboarding_rejection(jsonb,uuid,uuid) TO piggyvest_primary_provisioner;
COMMIT;

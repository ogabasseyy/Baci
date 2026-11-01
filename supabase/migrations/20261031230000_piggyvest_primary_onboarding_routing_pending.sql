-- Onboarding creates the PiggyVest customer with main-wallet interest routed
-- to the Ogabassey payout wallet, then reads the wallet back to prove it. When
-- creation succeeded but that readback failed or did not show the settings
-- yet, the intent was recorded 'unknown', which requires the provider ids to
-- be discarded. A status refresh then found nothing to re-read, and the
-- customer had to resubmit their BVN to finish setup.
--
-- New state 'routing_pending' keeps the provider customer and wallet ids of
-- such a wallet without making it usable: every spend, credit or usable read
-- (read_onboarding, verify_onboarding, inflows, bank inbox, savings, card,
-- interest) accepts only 'accepted' or 'verified', and claim_onboarding
-- reports it as pending without ever re-dispatching creation.
--
-- Wallet-bearing protections, by contrast, must follow the provider wallet,
-- not the state: a routing_pending intent, and one rejected over its routing,
-- still hold a real PiggyVest wallet with an open DVA. The customer-deletion
-- guard and both DVA-closure checks (20261008095500) are redefined to cover
-- every intent that holds provider ids, so the DVA must be closed before the
-- customer can be deleted, whatever the onboarding state.
--   * record_onboarding_routing_pending: dispatched -> routing_pending, ids
--     kept together with the payout wallet the customer was created with
--     (settings are fixed at creation, so a later configuration change must
--     not make a correctly routed wallet look contradicted).
--   * read_onboarding_routing: the intent id, kept ids and that payout
--     wallet, read-only, for the scoped owner.
--   * resolve_onboarding_routing: after the application re-reads the wallet,
--     routing_pending -> accepted when the routing is proven, or -> rejected
--     (terminal review; the ids are kept for review and DVA closure) when
--     the readback contradicts it. A wallet whose DVA closure was already
--     attested (offboarding) ends rejected either way: a closed DVA never
--     becomes a usable wallet.
-- All three are SECURITY DEFINER with a pinned search_path and are executable
-- only by the onboarding provisioner.
BEGIN;
ALTER TABLE piggyvest_primary.onboarding_intents
  ADD COLUMN routing_payout_wallet_id text
    CHECK (octet_length(routing_payout_wallet_id) BETWEEN 1 AND 512);
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT constraint_entry.conname INTO STRICT constraint_name
  FROM pg_catalog.pg_constraint constraint_entry
  WHERE constraint_entry.conrelid = 'piggyvest_primary.onboarding_intents'::regclass
    AND constraint_entry.contype = 'c'
    AND pg_catalog.pg_get_constraintdef(constraint_entry.oid) LIKE '%dispatched%accepted%unknown%verified%rejected%'
    AND pg_catalog.pg_get_constraintdef(constraint_entry.oid) NOT LIKE '%claim_token%';
  EXECUTE format(
    'ALTER TABLE piggyvest_primary.onboarding_intents DROP CONSTRAINT %I, ADD CHECK (state IN (''dispatched'', ''accepted'', ''unknown'', ''verified'', ''rejected'', ''routing_pending''))',
    constraint_name
  );
  SELECT constraint_entry.conname INTO STRICT constraint_name
  FROM pg_catalog.pg_constraint constraint_entry
  WHERE constraint_entry.conrelid = 'piggyvest_primary.onboarding_intents'::regclass
    AND constraint_entry.contype = 'c'
    AND pg_catalog.pg_get_constraintdef(constraint_entry.oid) LIKE '%claim_token IS NOT NULL%';
  EXECUTE format(
    'ALTER TABLE piggyvest_primary.onboarding_intents DROP CONSTRAINT %I, ADD CHECK ((state = ''dispatched'' AND claim_token IS NOT NULL AND provider_customer_id IS NULL AND provider_wallet_id IS NULL)'
    ' OR (state = ''unknown'' AND claim_token IS NULL AND provider_customer_id IS NULL AND provider_wallet_id IS NULL)'
    ' OR (state = ''rejected'' AND claim_token IS NULL AND (provider_customer_id IS NULL) = (provider_wallet_id IS NULL))'
    ' OR (state IN (''accepted'', ''verified'', ''routing_pending'') AND claim_token IS NULL AND provider_customer_id IS NOT NULL AND provider_wallet_id IS NOT NULL))',
    constraint_name
  );
END $$;
-- The creation-time payout wallet exists exactly while routing is pending.
ALTER TABLE piggyvest_primary.onboarding_intents
  ADD CHECK ((state = 'routing_pending') = (routing_payout_wallet_id IS NOT NULL));

CREATE FUNCTION piggyvest_primary.record_onboarding_routing_pending(scope jsonb, intent_id uuid, token uuid, provider_customer text, provider_wallet text, payout_wallet text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  IF provider_customer IS NULL OR provider_wallet IS NULL OR payout_wallet IS NULL THEN
    RAISE EXCEPTION 'incomplete provider identity' USING ERRCODE = '22023';
  END IF;
  UPDATE piggyvest_primary.onboarding_intents SET
    state = 'routing_pending', claim_token = NULL,
    provider_customer_id = provider_customer, provider_wallet_id = provider_wallet,
    routing_payout_wallet_id = payout_wallet,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = intent_id AND integration_id = (scope->>'integrationId')::uuid
    AND merchant_id = (scope->>'merchantId')::uuid AND customer_id = (scope->>'customerId')::uuid
    AND user_id = (scope->>'userId')::uuid AND state = 'dispatched' AND claim_token = token;
  RETURN FOUND;
END $$;

CREATE FUNCTION piggyvest_primary.read_onboarding_routing(scope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  intent piggyvest_primary.onboarding_intents%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  SELECT * INTO intent FROM piggyvest_primary.onboarding_intents
    WHERE integration_id = (scope->>'integrationId')::uuid
      AND merchant_id = (scope->>'merchantId')::uuid
      AND customer_id = (scope->>'customerId')::uuid
      AND user_id = (scope->>'userId')::uuid;
  IF NOT FOUND OR intent.state <> 'routing_pending' THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('intentId', intent.id, 'providerCustomerId', intent.provider_customer_id,
    'providerWalletId', intent.provider_wallet_id, 'payoutWalletId', intent.routing_payout_wallet_id);
END $$;

CREATE FUNCTION piggyvest_primary.resolve_onboarding_routing(scope jsonb, proof jsonb, routed boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  IF routed IS NULL OR proof IS NULL OR jsonb_typeof(proof) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(proof)) <> 2
    OR NOT proof ?& ARRAY['providerCustomerId','providerWalletId']
    OR jsonb_typeof(proof->'providerCustomerId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(proof->'providerWalletId') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'invalid routing proof' USING ERRCODE = '22023';
  END IF;
  UPDATE piggyvest_primary.onboarding_intents SET
    state = CASE WHEN routed AND provider_closed_at IS NULL THEN 'accepted' ELSE 'rejected' END,
    routing_payout_wallet_id = NULL,
    updated_at = pg_catalog.clock_timestamp()
  WHERE integration_id = (scope->>'integrationId')::uuid
    AND merchant_id = (scope->>'merchantId')::uuid AND customer_id = (scope->>'customerId')::uuid
    AND user_id = (scope->>'userId')::uuid AND state = 'routing_pending'
    AND provider_customer_id = proof->>'providerCustomerId'
    AND provider_wallet_id = proof->>'providerWalletId';
  RETURN FOUND;
END $$;

-- Wallet-bearing protections, redefined from 20261008095500 so they key on
-- the provider wallet instead of the onboarding state. Bodies are otherwise
-- unchanged; the unsettled-deposit check is preserved verbatim.
CREATE OR REPLACE FUNCTION piggyvest_primary.guard_intent_provider_closure()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.provider_closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'provider DVA closure requires a mapped intent' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.provider_closed_at IS DISTINCT FROM OLD.provider_closed_at THEN
    IF OLD.provider_closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'provider DVA closure is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.provider_wallet_id IS NULL OR NEW.provider_customer_id IS NULL THEN
      RAISE EXCEPTION 'provider DVA closure requires a mapped intent' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary.attest_provider_dva_closure(p_intent uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent piggyvest_primary.onboarding_intents%ROWTYPE;
BEGIN
  IF p_intent IS NULL THEN
    RAISE EXCEPTION 'invalid closure intent' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO STRICT intent FROM piggyvest_primary.onboarding_intents WHERE id = p_intent FOR UPDATE;
  IF intent.provider_wallet_id IS NULL OR intent.provider_customer_id IS NULL THEN
    RAISE EXCEPTION 'provider DVA closure requires a mapped intent' USING ERRCODE = '22023';
  END IF;
  IF intent.provider_closed_at IS NOT NULL THEN RETURN; END IF;
  UPDATE piggyvest_primary.onboarding_intents
    SET provider_closed_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE id = p_intent;
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary.block_unsettled_bank_inbox_customer_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.bank_signed_inbox inbox
    WHERE inbox.state IN ('pending','processing')
      AND EXISTS (
        SELECT 1 FROM piggyvest_primary.onboarding_intents intent
        WHERE intent.customer_id = OLD.id
          AND intent.provider_wallet_id = (convert_from(inbox.payload,'UTF8')::jsonb->>'pvb_wallet')
          AND intent.provider_customer_id = (convert_from(inbox.payload,'UTF8')::jsonb->>'customer_id')
      )
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with unsettled bank deposits' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.onboarding_intents intent
    WHERE intent.customer_id = OLD.id
      AND intent.provider_wallet_id IS NOT NULL
      AND intent.provider_closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with open provider DVA' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.guard_intent_provider_closure(),
  piggyvest_primary.block_unsettled_bank_inbox_customer_deletion(),
  piggyvest_primary.attest_provider_dva_closure(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.attest_provider_dva_closure(uuid)
  TO piggyvest_primary_provisioner;

REVOKE ALL ON FUNCTION piggyvest_primary.record_onboarding_routing_pending(jsonb,uuid,uuid,text,text,text),
  piggyvest_primary.read_onboarding_routing(jsonb),
  piggyvest_primary.resolve_onboarding_routing(jsonb,jsonb,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.record_onboarding_routing_pending(jsonb,uuid,uuid,text,text,text),
  piggyvest_primary.read_onboarding_routing(jsonb),
  piggyvest_primary.resolve_onboarding_routing(jsonb,jsonb,boolean)
  TO piggyvest_primary_provisioner;
COMMIT;

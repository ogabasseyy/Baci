BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='piggyvest_primary_goal_provisioner') THEN
    CREATE ROLE piggyvest_primary_goal_provisioner NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS piggyvest_primary.goal_provisioning_authorities (
  integration_id uuid PRIMARY KEY REFERENCES piggyvest_primary.integrations(id),
  executor_login name UNIQUE NOT NULL,
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS piggyvest_primary.goal_wallet_intents (
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  goal_id uuid NOT NULL REFERENCES public.customer_savings_goals(id),
  primary_intent_id uuid NOT NULL REFERENCES piggyvest_primary.onboarding_intents(id),
  wallet_name text UNIQUE NOT NULL,
  state text NOT NULL CHECK(state IN ('dispatched','unknown','accepted','enrolled')),
  claim_token uuid,
  provider_wallet_id text CHECK(octet_length(provider_wallet_id) BETWEEN 1 AND 512),
  interest_accepted boolean NOT NULL,
  interest_accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY(integration_id,goal_id), UNIQUE(integration_id,provider_wallet_id),
  CHECK((interest_accepted AND interest_accepted_at IS NOT NULL)
    OR (NOT interest_accepted AND interest_accepted_at IS NULL)),
  CHECK((state='dispatched' AND claim_token IS NOT NULL AND provider_wallet_id IS NULL)
    OR (state='unknown' AND claim_token IS NULL AND provider_wallet_id IS NULL)
    OR (state IN ('accepted','enrolled') AND claim_token IS NULL AND provider_wallet_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS primary_goal_wallet_goal_idx ON piggyvest_primary.goal_wallet_intents(goal_id);
CREATE INDEX IF NOT EXISTS primary_goal_wallet_intent_idx ON piggyvest_primary.goal_wallet_intents(primary_intent_id);
ALTER TABLE piggyvest_primary.goal_provisioning_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.goal_wallet_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_goal_authorities_deny ON piggyvest_primary.goal_provisioning_authorities
  AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_goal_intents_deny ON piggyvest_primary.goal_wallet_intents
  AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON piggyvest_primary.goal_provisioning_authorities,piggyvest_primary.goal_wallet_intents
  FROM PUBLIC,anon,authenticated,service_role,piggyvest_primary_goal_provisioner;

CREATE OR REPLACE FUNCTION piggyvest_primary.guard_goal_wallet_choice()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF (NEW.integration_id,NEW.goal_id,NEW.primary_intent_id,NEW.wallet_name,NEW.interest_accepted,NEW.interest_accepted_at)
    IS DISTINCT FROM (OLD.integration_id,OLD.goal_id,OLD.primary_intent_id,OLD.wallet_name,OLD.interest_accepted,OLD.interest_accepted_at) THEN
    RAISE EXCEPTION 'immutable goal wallet choice' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_goal_wallet_choice_immutable BEFORE UPDATE ON piggyvest_primary.goal_wallet_intents
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.guard_goal_wallet_choice();
REVOKE ALL ON FUNCTION piggyvest_primary.guard_goal_wallet_choice() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION piggyvest_primary.assert_goal_wallet_scope(scope jsonb, selected_goal uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE primary_id uuid;
BEGIN
  IF scope IS NULL OR jsonb_typeof(scope) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid goal scope' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(scope))<>6
    OR NOT scope ?& ARRAY['merchantId','customerId','userId','integrationId','businessId','environment'] THEN
    RAISE EXCEPTION 'invalid goal scope' USING ERRCODE='42501';
  END IF;
  SELECT intent.id INTO primary_id FROM piggyvest_primary.onboarding_intents intent
    JOIN piggyvest_primary.integrations binding ON binding.id=intent.integration_id AND binding.merchant_id=intent.merchant_id
    JOIN piggyvest_primary.goal_provisioning_authorities authority ON authority.integration_id=binding.id
    JOIN public.customers customer ON customer.id=intent.customer_id AND customer.merchant_id=intent.merchant_id AND customer.user_id=intent.user_id
    JOIN public.customer_savings_goals goal ON goal.customer_id=customer.id AND goal.merchant_id=customer.merchant_id
    WHERE binding.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
      AND binding.id=(scope->>'integrationId')::uuid AND binding.merchant_id=(scope->>'merchantId')::uuid
      AND binding.business_id=scope->>'businessId' AND binding.environment=scope->>'environment'
      AND intent.customer_id=(scope->>'customerId')::uuid AND intent.user_id=(scope->>'userId')::uuid
      AND intent.state='verified' AND goal.id=selected_goal AND goal.status='active'
      AND goal.terms_accepted_at IS NOT NULL AND goal.non_withdrawable_accepted_at IS NOT NULL
    FOR SHARE OF intent,binding,authority,customer FOR UPDATE OF goal;
  IF NOT FOUND THEN RAISE EXCEPTION 'owned verified savings goal unavailable' USING ERRCODE='42501'; END IF;
  RETURN primary_id;
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary.read_goal_wallet(scope jsonb, selected_goal uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  primary_id uuid := piggyvest_primary.assert_goal_wallet_scope(scope,selected_goal);
  intent piggyvest_primary.goal_wallet_intents%ROWTYPE;
  primary_intent piggyvest_primary.onboarding_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent FROM piggyvest_primary.goal_wallet_intents
    WHERE integration_id=(scope->>'integrationId')::uuid AND goal_id=selected_goal;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF intent.primary_intent_id<>primary_id THEN RAISE EXCEPTION 'primary intent changed' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT primary_intent FROM piggyvest_primary.onboarding_intents WHERE id=primary_id;
  RETURN jsonb_build_object('status',CASE WHEN intent.state='enrolled' THEN 'ready' ELSE 'pending' END,
    'claimToken',NULL,'providerCustomerId',primary_intent.provider_customer_id,
    'primaryWalletId',primary_intent.provider_wallet_id,'walletName',intent.wallet_name,'providerWalletId',intent.provider_wallet_id,
    'interestAccepted',intent.interest_accepted);
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary.prepare_goal_wallet(scope jsonb, selected_goal uuid, interest_choice boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  primary_id uuid := piggyvest_primary.assert_goal_wallet_scope(scope,selected_goal);
  primary_intent piggyvest_primary.onboarding_intents%ROWTYPE;
  intent piggyvest_primary.goal_wallet_intents%ROWTYPE;
  name text := 'baci-save:' || (scope->>'integrationId') || ':' || selected_goal::text;
  existing jsonb;
BEGIN
  IF interest_choice IS NULL THEN RAISE EXCEPTION 'explicit interest choice required' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.goal_wallet_intents
    WHERE integration_id=(scope->>'integrationId')::uuid AND goal_id=selected_goal) THEN
    existing := piggyvest_primary.read_goal_wallet(scope,selected_goal);
    IF (existing->>'interestAccepted')::boolean IS DISTINCT FROM interest_choice THEN
      RETURN existing || jsonb_build_object('status','conflict');
    END IF;
    RETURN existing;
  END IF;
  SELECT * INTO STRICT primary_intent FROM piggyvest_primary.onboarding_intents WHERE id=primary_id;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.savings_destinations
    WHERE integration_id=(scope->>'integrationId')::uuid AND goal_id=selected_goal) THEN
    RETURN jsonb_build_object('status','conflict','claimToken',NULL,
      'providerCustomerId',primary_intent.provider_customer_id,'primaryWalletId',primary_intent.provider_wallet_id,
      'walletName',name,'providerWalletId',NULL,'interestAccepted',interest_choice);
  END IF;
  INSERT INTO piggyvest_primary.goal_wallet_intents(integration_id,goal_id,primary_intent_id,wallet_name,state,claim_token,interest_accepted,interest_accepted_at)
    VALUES((scope->>'integrationId')::uuid,selected_goal,primary_id,name,'dispatched',pg_catalog.gen_random_uuid(),
      interest_choice,CASE WHEN interest_choice THEN pg_catalog.clock_timestamp() ELSE NULL END)
    RETURNING * INTO intent;
  RETURN jsonb_build_object('status','claimed','claimToken',intent.claim_token,
    'providerCustomerId',primary_intent.provider_customer_id,'primaryWalletId',primary_intent.provider_wallet_id,
    'walletName',intent.wallet_name,'providerWalletId',NULL,'interestAccepted',intent.interest_accepted);
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary.record_goal_wallet(scope jsonb, selected_goal uuid, token uuid, wallet text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE primary_id uuid := piggyvest_primary.assert_goal_wallet_scope(scope,selected_goal);
BEGIN
  IF wallet IS NOT NULL AND (octet_length(wallet) NOT BETWEEN 1 AND 512
    OR EXISTS(SELECT 1 FROM piggyvest_primary.onboarding_intents WHERE id=primary_id AND provider_wallet_id=wallet)) THEN
    RAISE EXCEPTION 'invalid goal wallet identity' USING ERRCODE='22023';
  END IF;
  UPDATE piggyvest_primary.goal_wallet_intents SET
    state=CASE WHEN wallet IS NULL THEN 'unknown' ELSE 'accepted' END,
    claim_token=NULL,provider_wallet_id=wallet,updated_at=pg_catalog.clock_timestamp()
    WHERE integration_id=(scope->>'integrationId')::uuid AND goal_id=selected_goal
      AND primary_intent_id=primary_id AND state='dispatched' AND claim_token=token;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary.enroll_goal_wallet(scope jsonb, selected_goal uuid, proof jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  primary_id uuid := piggyvest_primary.assert_goal_wallet_scope(scope,selected_goal);
  intent piggyvest_primary.goal_wallet_intents%ROWTYPE;
  primary_intent piggyvest_primary.onboarding_intents%ROWTYPE;
  field text;
BEGIN
  IF proof IS NULL OR jsonb_typeof(proof) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid goal wallet proof' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(proof))<>9
    OR NOT proof ?& ARRAY['providerCustomerId','providerWalletId','walletName','businessId','currency','status','type','hasFundingAccount','interestAccepted']
    OR proof->>'businessId' IS DISTINCT FROM scope->>'businessId'
    OR proof->>'currency' IS DISTINCT FROM 'NGN' OR proof->>'status' IS DISTINCT FROM 'active'
    OR proof->>'type' IS DISTINCT FROM 'api'
    OR proof->'hasFundingAccount' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(proof->'interestAccepted') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'invalid goal wallet proof' USING ERRCODE='22023';
  END IF;
  FOREACH field IN ARRAY ARRAY['providerCustomerId','providerWalletId','walletName','businessId','currency','status','type'] LOOP
    IF jsonb_typeof(proof->field) IS DISTINCT FROM 'string' OR octet_length(proof->>field) NOT BETWEEN 1 AND 512 THEN
      RAISE EXCEPTION 'invalid goal wallet field' USING ERRCODE='22023';
    END IF;
  END LOOP;
  SELECT * INTO STRICT primary_intent FROM piggyvest_primary.onboarding_intents WHERE id=primary_id;
  SELECT * INTO intent FROM piggyvest_primary.goal_wallet_intents
    WHERE integration_id=(scope->>'integrationId')::uuid AND goal_id=selected_goal AND primary_intent_id=primary_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF proof->'interestAccepted' IS DISTINCT FROM to_jsonb(intent.interest_accepted) THEN RETURN false; END IF;
  IF proof->>'providerCustomerId'<>primary_intent.provider_customer_id
    OR proof->>'providerWalletId'=primary_intent.provider_wallet_id
    OR proof->>'walletName'<>intent.wallet_name
    OR (intent.provider_wallet_id IS NOT NULL AND intent.provider_wallet_id<>proof->>'providerWalletId') THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.onboarding_intents
    WHERE integration_id=intent.integration_id AND provider_wallet_id=proof->>'providerWalletId') THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.goal_wallet_intents
    WHERE integration_id=intent.integration_id AND goal_id<>selected_goal AND provider_wallet_id=proof->>'providerWalletId') THEN RETURN false; END IF;
  INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
    VALUES(intent.integration_id,selected_goal,primary_id,proof->>'providerWalletId',true)
    ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM piggyvest_primary.savings_destinations
    WHERE integration_id=intent.integration_id AND goal_id=selected_goal AND intent_id=primary_id
      AND provider_wallet_id=proof->>'providerWalletId' AND enabled) THEN RETURN false; END IF;
  UPDATE piggyvest_primary.goal_wallet_intents SET state='enrolled',claim_token=NULL,
    provider_wallet_id=proof->>'providerWalletId',updated_at=pg_catalog.clock_timestamp()
    WHERE integration_id=intent.integration_id AND goal_id=selected_goal AND state<>'enrolled';
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.assert_goal_wallet_scope(jsonb,uuid),
  piggyvest_primary.read_goal_wallet(jsonb,uuid),piggyvest_primary.prepare_goal_wallet(jsonb,uuid,boolean),
  piggyvest_primary.record_goal_wallet(jsonb,uuid,uuid,text),piggyvest_primary.enroll_goal_wallet(jsonb,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA piggyvest_primary TO piggyvest_primary_goal_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_goal_wallet(jsonb,uuid),
  piggyvest_primary.prepare_goal_wallet(jsonb,uuid,boolean),piggyvest_primary.record_goal_wallet(jsonb,uuid,uuid,text),
  piggyvest_primary.enroll_goal_wallet(jsonb,uuid,jsonb) TO piggyvest_primary_goal_provisioner;
COMMIT;

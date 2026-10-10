BEGIN;
CREATE TABLE piggyvest_primary.paid_interest_crosswalks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  goal_id uuid NOT NULL REFERENCES public.customer_savings_goals(id),
  api_wallet_id text NOT NULL,api_customer_id text NOT NULL,onboarding_customer_id text NOT NULL,
  webhook_customer_id text NOT NULL,source_wallet_id text NOT NULL,accrued_wallet_id text NOT NULL,
  destination_wallet_id text NOT NULL,envelope_destination_wallet_id text,
  provider_evidence_sha256 text NOT NULL CHECK(provider_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  policy_evidence_sha256 text NOT NULL CHECK(policy_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  policy_reference text NOT NULL CHECK(octet_length(policy_reference) BETWEEN 1 AND 512),
  allocation_policy text NOT NULL CHECK(allocation_policy='provider_net_is_customer_plan_interest'),
  enabled boolean NOT NULL DEFAULT false,
  UNIQUE(integration_id,api_wallet_id),
  FOREIGN KEY(integration_id,goal_id) REFERENCES piggyvest_primary.savings_destinations(integration_id,goal_id)
);
CREATE INDEX primary_interest_crosswalk_goal_idx ON piggyvest_primary.paid_interest_crosswalks(goal_id);
CREATE FUNCTION piggyvest_primary.guard_interest_crosswalk()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF (to_jsonb(NEW)-'enabled') IS DISTINCT FROM (to_jsonb(OLD)-'enabled') THEN
    RAISE EXCEPTION 'immutable interest crosswalk' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_interest_crosswalk_update BEFORE UPDATE ON piggyvest_primary.paid_interest_crosswalks
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.guard_interest_crosswalk();
CREATE TRIGGER primary_interest_crosswalk_delete BEFORE DELETE OR TRUNCATE ON piggyvest_primary.paid_interest_crosswalks
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_ledger.immutable();

CREATE TABLE piggyvest_primary.paid_interest_receipts (
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),payout_id text NOT NULL,
  crosswalk_id uuid NOT NULL REFERENCES piggyvest_primary.paid_interest_crosswalks(id),
  goal_id uuid NOT NULL REFERENCES public.customer_savings_goals(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),customer_id uuid NOT NULL REFERENCES public.customers(id),
  net_kobo bigint NOT NULL CHECK(net_kobo BETWEEN 0 AND 9007199254740991),
  financial_identity jsonb NOT NULL,body_digest text NOT NULL CHECK(body_digest ~ '^[a-f0-9]{64}$'),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(integration_id,payout_id)
);
CREATE INDEX primary_interest_receipt_crosswalk_idx ON piggyvest_primary.paid_interest_receipts(crosswalk_id);
CREATE INDEX primary_interest_receipt_goal_idx ON piggyvest_primary.paid_interest_receipts(goal_id);
CREATE INDEX primary_interest_receipt_merchant_idx ON piggyvest_primary.paid_interest_receipts(merchant_id);
CREATE INDEX primary_interest_receipt_customer_idx ON piggyvest_primary.paid_interest_receipts(customer_id);
CREATE TABLE piggyvest_primary.paid_interest_delivery_ids (
  integration_id uuid NOT NULL,event_id text NOT NULL,payout_id text NOT NULL,
  PRIMARY KEY(integration_id,event_id),
  FOREIGN KEY(integration_id,payout_id) REFERENCES piggyvest_primary.paid_interest_receipts(integration_id,payout_id)
);
CREATE INDEX primary_interest_delivery_payout_idx ON piggyvest_primary.paid_interest_delivery_ids(integration_id,payout_id);
CREATE TABLE piggyvest_primary.paid_interest_reversals (
  integration_id uuid NOT NULL,provider_reversal_id text NOT NULL,payout_id text NOT NULL,
  amount_kobo bigint NOT NULL CHECK(amount_kobo BETWEEN 1 AND 9007199254740991),
  provider_evidence_sha256 text NOT NULL CHECK(provider_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_reference text NOT NULL CHECK(octet_length(evidence_reference) BETWEEN 1 AND 512),
  PRIMARY KEY(integration_id,provider_reversal_id),
  FOREIGN KEY(integration_id,payout_id) REFERENCES piggyvest_primary.paid_interest_receipts(integration_id,payout_id)
);
CREATE INDEX primary_interest_reversal_payout_idx ON piggyvest_primary.paid_interest_reversals(integration_id,payout_id);
ALTER TABLE piggyvest_primary.paid_interest_crosswalks ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.paid_interest_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.paid_interest_delivery_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.paid_interest_reversals ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_interest_crosswalk_deny ON piggyvest_primary.paid_interest_crosswalks AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_interest_receipt_deny ON piggyvest_primary.paid_interest_receipts AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_interest_delivery_deny ON piggyvest_primary.paid_interest_delivery_ids AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_interest_reversal_deny ON piggyvest_primary.paid_interest_reversals AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON piggyvest_primary.paid_interest_crosswalks,piggyvest_primary.paid_interest_receipts,
  piggyvest_primary.paid_interest_delivery_ids,piggyvest_primary.paid_interest_reversals
  FROM PUBLIC,anon,authenticated,service_role,piggyvest_primary_evidence;
CREATE TRIGGER primary_interest_receipt_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON piggyvest_primary.paid_interest_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_ledger.immutable();
CREATE TRIGGER primary_interest_delivery_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON piggyvest_primary.paid_interest_delivery_ids
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_ledger.immutable();
CREATE TRIGGER primary_interest_reversal_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON piggyvest_primary.paid_interest_reversals
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_ledger.immutable();

CREATE FUNCTION piggyvest_primary.assert_paid_interest_worker(p_integration uuid,p_environment text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM integration.id FROM piggyvest_primary.integrations integration
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=integration.id
    WHERE integration.id=p_integration AND integration.environment=p_environment AND p_environment='production'
      AND integration.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
    FOR SHARE OF integration,authority;
  IF NOT FOUND OR current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'primary interest evidence authority unavailable' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION piggyvest_primary.eligible_interest_crosswalk(p_integration uuid,p_selection jsonb)
RETURNS SETOF piggyvest_primary.paid_interest_crosswalks
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT mapping.* FROM piggyvest_primary.paid_interest_crosswalks mapping
  JOIN piggyvest_primary.integrations integration ON integration.id=mapping.integration_id
  JOIN piggyvest_primary.savings_destinations destination ON destination.integration_id=mapping.integration_id
    AND destination.goal_id=mapping.goal_id AND destination.provider_wallet_id=mapping.api_wallet_id
  JOIN piggyvest_primary.goal_wallet_intents choice ON choice.integration_id=destination.integration_id
    AND choice.goal_id=destination.goal_id AND choice.primary_intent_id=destination.intent_id
    AND choice.provider_wallet_id=destination.provider_wallet_id
  JOIN piggyvest_primary.onboarding_intents intent ON intent.id=destination.intent_id
    AND intent.integration_id=integration.id AND intent.merchant_id=integration.merchant_id
    AND intent.provider_customer_id=mapping.onboarding_customer_id
  JOIN public.customers customer ON customer.id=intent.customer_id AND customer.merchant_id=intent.merchant_id AND customer.user_id=intent.user_id
  JOIN public.customer_savings_goals goal ON goal.id=mapping.goal_id AND goal.customer_id=customer.id AND goal.merchant_id=customer.merchant_id
  WHERE mapping.integration_id=p_integration AND mapping.enabled AND integration.enabled AND integration.environment='production'
    AND destination.enabled AND choice.state='enrolled' AND choice.interest_accepted AND choice.interest_accepted_at IS NOT NULL
    AND intent.state='verified' AND mapping.api_wallet_id<>intent.provider_wallet_id AND goal.goal_kind='legacy'
    AND mapping.webhook_customer_id=p_selection->>'webhookCustomerId'
    AND mapping.source_wallet_id=p_selection->>'sourceWalletId' AND mapping.accrued_wallet_id=p_selection->>'accruedWalletId'
    AND mapping.destination_wallet_id=p_selection->>'destinationWalletId'
    AND coalesce(to_jsonb(mapping.envelope_destination_wallet_id),'null'::jsonb) IS NOT DISTINCT FROM p_selection->'envelopeDestinationWalletId'
$$;

CREATE FUNCTION piggyvest_primary.read_paid_interest_crosswalk(p_integration uuid,p_environment text,p_selection jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE mapping piggyvest_primary.paid_interest_crosswalks%ROWTYPE; business text;
BEGIN
  PERFORM piggyvest_primary.assert_paid_interest_worker(p_integration,p_environment);
  IF jsonb_typeof(p_selection) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid interest selection' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_selection))<>5
    OR NOT p_selection ?& ARRAY['webhookCustomerId','sourceWalletId','accruedWalletId','destinationWalletId','envelopeDestinationWalletId'] THEN
    RAISE EXCEPTION 'invalid interest selection' USING ERRCODE='22023';
  END IF;
  SELECT * INTO mapping FROM piggyvest_primary.eligible_interest_crosswalk(p_integration,p_selection);
  IF NOT FOUND OR (SELECT count(*) FROM piggyvest_primary.eligible_interest_crosswalk(p_integration,p_selection))<>1 THEN RETURN NULL; END IF;
  SELECT business_id INTO business FROM piggyvest_primary.integrations WHERE id=p_integration;
  RETURN p_selection||jsonb_build_object('id',mapping.id,'integrationId',p_integration,'environment',p_environment,
    'businessId',business,'apiWalletId',mapping.api_wallet_id,'apiCustomerId',mapping.api_customer_id,
    'providerEvidenceSha256',mapping.provider_evidence_sha256,'policyReference',mapping.policy_reference);
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.guard_interest_crosswalk(),piggyvest_primary.assert_paid_interest_worker(uuid,text),
  piggyvest_primary.eligible_interest_crosswalk(uuid,jsonb),piggyvest_primary.read_paid_interest_crosswalk(uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_paid_interest_crosswalk(uuid,text,jsonb) TO piggyvest_primary_evidence;
COMMIT;

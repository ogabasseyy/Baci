BEGIN;
CREATE TABLE prefunded_card.evidence_authorities (
  integration_id uuid PRIMARY KEY REFERENCES piggyvest_staging.integrations(id),
  business_id text COLLATE "C" NOT NULL CHECK (octet_length(business_id) BETWEEN 1 AND 512),
  system_identifier text NOT NULL CHECK (system_identifier ~ '^[0-9]{1,20}$'),
  ingestion_login name NOT NULL,
  reader_login name NOT NULL,
  currency text NOT NULL CHECK (currency='NGN'),
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE prefunded_card.provider_evidence (
  integration_id uuid NOT NULL REFERENCES prefunded_card.evidence_authorities(integration_id),
  event_id text COLLATE "C" NOT NULL CHECK (octet_length(event_id) BETWEEN 1 AND 512),
  fingerprint text COLLATE "C" NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  observation jsonb NOT NULL CHECK (jsonb_typeof(observation)='object'),
  business_id text COLLATE "C" NOT NULL,
  ingestion_login name NOT NULL,
  conflicted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,event_id)
);
CREATE INDEX prefunded_evidence_transaction_idx ON prefunded_card.provider_evidence
  (integration_id,(observation->>'providerTransactionId'));
CREATE INDEX prefunded_evidence_reference_idx ON prefunded_card.provider_evidence USING gin((observation->'references'));
CREATE TABLE prefunded_card.inflow_attributions (
  integration_id uuid NOT NULL,
  event_id text COLLATE "C" NOT NULL,
  result jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,event_id),
  FOREIGN KEY(integration_id,event_id) REFERENCES prefunded_card.provider_evidence(integration_id,event_id)
);
CREATE TABLE prefunded_card.evidence_conflicts (
  integration_id uuid NOT NULL,
  event_id text COLLATE "C" NOT NULL,
  operation_id uuid NOT NULL REFERENCES prefunded_card.operations(id),
  already_applied boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,event_id,operation_id),
  FOREIGN KEY(integration_id,event_id) REFERENCES prefunded_card.provider_evidence(integration_id,event_id)
);
CREATE INDEX prefunded_evidence_conflict_operation_idx ON prefunded_card.evidence_conflicts(operation_id);
ALTER TABLE prefunded_card.evidence_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.provider_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.inflow_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.evidence_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY prefunded_evidence_authorities_deny ON prefunded_card.evidence_authorities USING(false) WITH CHECK(false);
CREATE POLICY prefunded_provider_evidence_deny ON prefunded_card.provider_evidence USING(false) WITH CHECK(false);
CREATE POLICY prefunded_inflow_attributions_deny ON prefunded_card.inflow_attributions USING(false) WITH CHECK(false);
CREATE POLICY prefunded_evidence_conflicts_deny ON prefunded_card.evidence_conflicts USING(false) WITH CHECK(false);
REVOKE ALL ON prefunded_card.evidence_authorities,prefunded_card.provider_evidence,prefunded_card.inflow_attributions,prefunded_card.evidence_conflicts
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
CREATE TRIGGER prefunded_evidence_authority_immutable BEFORE UPDATE OR DELETE ON prefunded_card.evidence_authorities
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_evidence_authority_no_truncate BEFORE TRUNCATE ON prefunded_card.evidence_authorities
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_evidence_conflict_immutable BEFORE UPDATE OR DELETE ON prefunded_card.evidence_conflicts
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_evidence_conflict_no_truncate BEFORE TRUNCATE ON prefunded_card.evidence_conflicts
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_projection_mutation();

CREATE FUNCTION prefunded_card.evidence_scope(p_integration uuid,p_system text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE authority prefunded_card.evidence_authorities%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
    OR p_system IS NULL OR p_system IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system()) THEN
    RAISE EXCEPTION 'provider evidence database refused' USING ERRCODE='42501';
  END IF;
  SELECT * INTO authority FROM prefunded_card.evidence_authorities WHERE integration_id=p_integration
    AND system_identifier=p_system AND enabled AND session_user IN (ingestion_login,reader_login) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider evidence authority refused' USING ERRCODE='42501'; END IF;
  PERFORM id FROM piggyvest_staging.integrations WHERE id=p_integration AND enabled
    AND expected_provider_account_id=authority.business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider evidence registry refused' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('businessId',authority.business_id,'currency',authority.currency);
END $$;
REVOKE ALL ON FUNCTION prefunded_card.evidence_scope(uuid,text) FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
CREATE FUNCTION prefunded_card.evidence_destination_mapping(p_integration uuid,p_system text,p_wallet text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  PERFORM prefunded_card.evidence_scope(p_integration,p_system);
  SELECT jsonb_build_object('providerWalletId',mapping.provider_wallet_id,'providerCustomerId',mapping.provider_customer_id)
    INTO result FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    JOIN prefunded_card.credit_routes route ON route.integration_id=mapping.integration_id AND route.goal_id=mapping.goal_id
      AND route.merchant_id=mapping.merchant_id AND route.customer_id=mapping.customer_id AND route.system_identifier=p_system
    WHERE mapping.integration_id=p_integration AND mapping.provider_wallet_id=p_wallet;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION prefunded_card.evidence_destination_mapping(uuid,text,text)
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
COMMIT;

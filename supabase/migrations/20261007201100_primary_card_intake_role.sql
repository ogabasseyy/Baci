BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='primary_card_signed_intake') THEN
    CREATE ROLE primary_card_signed_intake NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS piggyvest_primary_card.intake_authority (
  integration_id uuid PRIMARY KEY REFERENCES piggyvest_primary_card.settings(integration_id),
  login_name text NOT NULL CHECK(login_name='baci_primary_card_intake'),
  expires_at timestamptz NOT NULL,
  enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE piggyvest_primary_card.intake_authority ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_card_intake_authority_deny ON piggyvest_primary_card.intake_authority AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON piggyvest_primary_card.intake_authority FROM PUBLIC,anon,authenticated,service_role,primary_card_signed_intake,primary_card_custody_evidence,primary_card_transfer_worker;
GRANT USAGE ON SCHEMA piggyvest_primary_card TO primary_card_signed_intake;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.inbox_ready(target_integration uuid, environment text, capability jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF SESSION_USER='baci_primary_card_intake' THEN
    PERFORM settings.integration_id FROM piggyvest_primary_card.settings settings
    JOIN piggyvest_primary_card.intake_authority intake ON intake.integration_id=settings.integration_id
    JOIN piggyvest_primary_card.treasury_policy policy ON policy.integration_id=settings.integration_id
    JOIN piggyvest_primary.integrations integration ON integration.id=settings.integration_id
    WHERE settings.integration_id=$1 AND settings.environment=$2 AND settings.enabled AND intake.enabled AND policy.enabled AND integration.enabled
      AND settings.expires_at>clock_timestamp() AND intake.expires_at>clock_timestamp() AND intake.expires_at<=settings.expires_at
      AND intake.login_name=SESSION_USER AND integration.environment=settings.environment
      AND integration.business_id=settings.business_id AND integration.merchant_id=settings.merchant_id
      AND pg_has_role(SESSION_USER,'primary_card_signed_intake','MEMBER')
    FOR SHARE OF settings,intake,policy,integration;
    IF NOT FOUND THEN RAISE EXCEPTION 'intake authority unavailable' USING ERRCODE='42501'; END IF;
  ELSE
    PERFORM piggyvest_primary_card.assert_worker($1,$2,true);
  END IF;
  PERFORM configured.integration_id FROM piggyvest_primary_card.inbox_capabilities configured
  JOIN piggyvest_primary_card.settings settings ON settings.integration_id=configured.integration_id
  WHERE configured.integration_id=$1 AND configured.enabled AND capability-'expiresAt'=jsonb_build_object(
    'contractId',configured.contract_id,'evidenceIssuer',configured.evidence_issuer,
    'treasuryWebhookCustomerId',configured.treasury_webhook_customer_id,'transactionCustomerId',configured.transaction_customer_id,
    'payloadContract',configured.payload_contract,'mappingContract',configured.mapping_contract,
    'merchantId',settings.merchant_id,'businessId',settings.business_id)
    AND (capability->>'expiresAt')::timestamptz=settings.expires_at FOR SHARE;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary_card.inbox_ready(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,primary_card_signed_intake;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.signed_inbox_readiness(uuid,text,jsonb),piggyvest_primary_card.enqueue_signed_inbox(uuid,text,jsonb,text,text) TO primary_card_signed_intake;
COMMIT;

-- Drain pre-expiry transfer and custody work after the integration
-- deadline. assert_worker and inbox_ready require settings.expires_at in
-- the future, so once the deadline passes the transfer worker cannot
-- select, claim, dispatch, or record; the custody inbox cannot enqueue,
-- claim, finish, or settle. The checkout drain path can therefore record
-- a successful Paystack charge while every downstream step needed to
-- credit it is permanently disabled. Every worker-path function
-- structurally requires a pre-existing operation or inbox row, and
-- reserve (assert_scope, strict) is the sole creator — so post-expiry
-- worker activity can only complete pre-expiry work, never start new
-- exposure. Drop the integration-deadline freshness check from both
-- gates while keeping every other binding: enabled flags, environment,
-- business, merchant, and logins. The intake credential expiry
-- (intake.expires_at) stays enforced as credential hygiene independent
-- of the deadline, but its must-not-outlive-the-integration binding
-- goes with the deadline: otherwise operators could never re-issue
-- intake credentials to drain, and the credential's own expiry already
-- bounds the drain window. Operators still stop workers via the
-- enabled flags, credentials, or the scheduler.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.assert_worker(integration_id uuid, environment text, custody boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM config.integration_id FROM piggyvest_primary_card.settings config
  JOIN piggyvest_primary_card.treasury_policy policy ON policy.integration_id=config.integration_id
  JOIN piggyvest_primary.integrations integration ON integration.id=config.integration_id
  WHERE config.integration_id=$1 AND config.environment=$2 AND config.enabled AND integration.enabled
    AND policy.enabled AND integration.environment=config.environment
    AND integration.business_id=config.business_id AND integration.merchant_id=config.merchant_id
    AND SESSION_USER=CASE WHEN custody THEN policy.custody_login ELSE policy.transfer_login END
  FOR SHARE OF config,policy,integration;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer authority unavailable' USING ERRCODE='42501'; END IF;
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.inbox_ready(target_integration uuid, environment text, capability jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF SESSION_USER='baci_primary_card_intake' THEN
    PERFORM settings.integration_id FROM piggyvest_primary_card.settings settings
    JOIN piggyvest_primary_card.intake_authority intake ON intake.integration_id=settings.integration_id
    JOIN piggyvest_primary_card.treasury_policy policy ON policy.integration_id=settings.integration_id
    JOIN piggyvest_primary.integrations integration ON integration.id=settings.integration_id
    WHERE settings.integration_id=$1 AND settings.environment=$2 AND settings.enabled AND intake.enabled AND policy.enabled AND integration.enabled
      AND intake.expires_at>clock_timestamp()
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
COMMIT;

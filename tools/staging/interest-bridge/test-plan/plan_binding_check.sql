CREATE FUNCTION pg_temp.plan_binding_check(payload jsonb, goal_uuid uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF (payload->>'goalOnly')::boolean
    AND EXISTS(SELECT 1 FROM piggyvest_savings_ledger.interest_policies WHERE goal_id=goal_uuid) THEN
    RAISE EXCEPTION 'test plan goal only policy must be absent';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM piggyvest_staging.wallet_goal_mappings WHERE goal_id=goal_uuid
      AND integration_id=(payload->>'integrationId')::uuid AND provider_wallet_id=payload->>'publicWalletId'
      AND provider_customer_id=payload->>'webhookCustomerId' AND merchant_id=(payload->>'merchantId')::uuid
      AND customer_id=(payload->>'customerId')::uuid)
    OR NOT EXISTS(SELECT 1 FROM piggyvest_savings_ledger.bindings WHERE goal_id=goal_uuid
      AND integration_id=(payload->>'integrationId')::uuid AND merchant_id=(payload->>'merchantId')::uuid
      AND customer_id=(payload->>'customerId')::uuid AND authorized_login='prefunded_treasury_operator' AND enabled)
    OR (NOT (payload->>'goalOnly')::boolean AND NOT EXISTS(SELECT 1 FROM piggyvest_savings_ledger.interest_policies WHERE goal_id=goal_uuid
      AND integration_id=(payload->>'integrationId')::uuid AND merchant_id=(payload->>'merchantId')::uuid
      AND customer_id=(payload->>'customerId')::uuid AND provider_business_id=payload->>'businessId'
      AND provider_customer_id=payload->>'payoutProviderCustomerId' AND interest_source_wallet_id=payload->>'sourceWalletId'
      AND payout_wallet_id=payload->>'payoutWalletId' AND interest_enabled AND enabled
      AND eligibility_evidence=payload->>'eligibilityReference' AND policy_reference=payload->>'policyReference'
      AND expires_at=(payload->>'expiresAt')::timestamptz)) THEN
    RAISE EXCEPTION 'test plan immutable binding conflict';
  END IF;
END $$;

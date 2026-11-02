-- Read-only eligibility for an explicit, fingerprint-bound setup retry.
-- This grants no reclaim, adoption or provider-write authority.
BEGIN;
CREATE FUNCTION piggyvest_primary.can_recover_onboarding(scope jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  RETURN EXISTS (
    SELECT 1 FROM piggyvest_primary.onboarding_intents intent
    WHERE intent.integration_id = (scope->>'integrationId')::uuid
      AND intent.merchant_id = (scope->>'merchantId')::uuid
      AND intent.customer_id = (scope->>'customerId')::uuid
      AND intent.user_id = (scope->>'userId')::uuid
      AND intent.provider_customer_id IS NULL AND intent.provider_wallet_id IS NULL
      AND (intent.state = 'unknown' OR
        (intent.state = 'dispatched' AND intent.updated_at < clock_timestamp() - interval '5 minutes'))
  );
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.can_recover_onboarding(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.can_recover_onboarding(jsonb)
  TO piggyvest_primary_provisioner;
COMMIT;

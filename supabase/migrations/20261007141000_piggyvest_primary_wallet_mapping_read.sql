BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.read_onboarding(scope jsonb)
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
  IF NOT FOUND OR intent.state NOT IN ('accepted','verified') THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('providerCustomerId', intent.provider_customer_id, 'providerWalletId', intent.provider_wallet_id);
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.read_onboarding(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_onboarding(jsonb) TO piggyvest_primary_provisioner;
COMMIT;

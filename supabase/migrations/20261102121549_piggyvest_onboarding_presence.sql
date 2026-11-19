-- Read-only onboarding presence for the primary wallet GET. The route can
-- answer "not started" for a customer with no durable onboarding intent
-- before it reads the provider, the wallet mapping or review storage.
--
-- Same scope contract as every onboarding RPC: assert_onboarding_scope binds
-- the call to an enabled integration whose executor_login is SESSION_USER and
-- to a customer the scoped user owns, so a scope the session cannot own
-- raises 42501 instead of reading false. The lookup uses claim_onboarding's
-- own (integration, customer) key, so any intent a new claim would collide
-- with reads true. Granted only to the restricted provisioner group; closed
-- to PUBLIC, client roles and service_role.
BEGIN;

CREATE FUNCTION piggyvest_primary.has_onboarding(scope jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  RETURN EXISTS (
    SELECT 1 FROM piggyvest_primary.onboarding_intents intent
    WHERE intent.integration_id = (scope->>'integrationId')::uuid
      AND intent.merchant_id = (scope->>'merchantId')::uuid
      AND intent.customer_id = (scope->>'customerId')::uuid
  );
END $$;

REVOKE ALL ON FUNCTION piggyvest_primary.has_onboarding(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.has_onboarding(jsonb)
  TO piggyvest_primary_provisioner;

COMMIT;

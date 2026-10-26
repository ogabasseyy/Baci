CREATE OR REPLACE FUNCTION piggyvest_primary.has_onboarding(scope jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  RETURN EXISTS (SELECT 1 FROM piggyvest_primary.onboarding_intents intent
    WHERE intent.integration_id=(scope->>'integrationId')::uuid
      AND intent.merchant_id=(scope->>'merchantId')::uuid
      AND intent.customer_id=(scope->>'customerId')::uuid
      AND intent.user_id=(scope->>'userId')::uuid);
END;
$function$;
REVOKE ALL ON FUNCTION piggyvest_primary.has_onboarding(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION piggyvest_primary.has_onboarding(jsonb) TO piggyvest_primary_provisioner;

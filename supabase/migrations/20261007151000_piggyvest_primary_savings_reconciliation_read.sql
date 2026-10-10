BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.read_dispatched_savings(integration_id uuid,environment text,operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reservation jsonb;
BEGIN
  PERFORM binding.id FROM piggyvest_primary.integrations binding
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=binding.id
    WHERE binding.id=read_dispatched_savings.integration_id AND binding.environment=read_dispatched_savings.environment
      AND binding.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
    FOR SHARE OF binding,authority;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation authority unavailable' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('operationId',operation.id,'goalId',operation.goal_id,'amountKobo',operation.amount_kobo,
      'sourceWalletId',operation.source_wallet_id,'destinationWalletId',operation.destination_wallet_id,
      'reference',operation.reference,'businessId',binding.business_id)
    INTO reservation FROM piggyvest_primary.savings_operations operation
    JOIN piggyvest_primary.integrations binding ON binding.id=operation.integration_id
    JOIN piggyvest_primary.onboarding_intents intent ON intent.id=operation.intent_id AND intent.integration_id=binding.id
    JOIN public.customers customer ON customer.id=intent.customer_id AND customer.merchant_id=intent.merchant_id AND customer.user_id=intent.user_id
    WHERE operation.id=operation_id AND operation.integration_id=read_dispatched_savings.integration_id
      AND operation.state='dispatched' AND intent.state IN ('accepted','verified') AND intent.provider_wallet_id=operation.source_wallet_id;
  RETURN reservation;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.read_dispatched_savings(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_dispatched_savings(uuid,text,uuid) TO piggyvest_primary_evidence;
COMMIT;

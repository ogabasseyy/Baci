CREATE OR REPLACE FUNCTION piggyvest_primary.read_pending_savings(scope jsonb, goal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE recovered jsonb;
BEGIN
  IF scope IS NULL OR jsonb_typeof(scope)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(scope))<>6 THEN
    RAISE EXCEPTION 'invalid savings scope' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM piggyvest_primary.integrations binding
    JOIN piggyvest_primary.savings_authorities authority ON authority.integration_id=binding.id
    JOIN public.customers customer ON customer.merchant_id=binding.merchant_id
    JOIN public.customer_savings_goals goal ON goal.customer_id=customer.id AND goal.merchant_id=customer.merchant_id
    WHERE binding.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
      AND binding.id=(scope->>'integrationId')::uuid
      AND binding.merchant_id=(scope->>'merchantId')::uuid
      AND binding.business_id=scope->>'businessId' AND binding.environment=scope->>'environment'
      AND customer.id=(scope->>'customerId')::uuid AND customer.user_id=(scope->>'userId')::uuid
      AND goal.id=read_pending_savings.goal_id
  ) THEN
    RAISE EXCEPTION 'savings recovery ownership unavailable' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object('operationId',operation.id,'goalId',operation.goal_id,
    'amountKobo',operation.amount_kobo,'state',operation.state) INTO recovered
  FROM piggyvest_primary.savings_operations operation
  JOIN piggyvest_primary.onboarding_intents intent ON intent.id=operation.intent_id
  JOIN public.customer_savings_goals goal ON goal.id=operation.goal_id
  WHERE operation.integration_id=(scope->>'integrationId')::uuid
    AND intent.integration_id=operation.integration_id
    AND intent.merchant_id=(scope->>'merchantId')::uuid
    AND intent.customer_id=(scope->>'customerId')::uuid AND intent.user_id=(scope->>'userId')::uuid
    AND operation.goal_id=read_pending_savings.goal_id
    AND goal.customer_id=intent.customer_id AND goal.merchant_id=intent.merchant_id
    AND operation.state IN ('reserved','dispatched')
  ORDER BY operation.created_at,operation.id LIMIT 1;
  RETURN recovered;
END;
$function$;

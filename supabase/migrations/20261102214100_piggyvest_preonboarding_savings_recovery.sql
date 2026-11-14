BEGIN;
-- Pending-savings recovery no longer depends on onboarding state. The previous
-- body resolved the caller through assert_savings_scope, which demands an
-- accepted or verified onboarding intent, so a customer who had not finished
-- onboarding got 42501 (and the pending route answered 503) instead of
-- "nothing pending". Ownership is now proven directly: an enabled integration
-- and savings authority bound to SESSION_USER, the scoped customer and user,
-- and a goal that customer owns. Any of those failing still raises 42501.
-- The read returns only reserved or dispatched operations reached through the
-- caller's own intents and never writes. It answers NULL only when nothing is
-- in flight on the goal at all; an in-flight transfer it cannot attribute to
-- the scoped integration also raises 42501.
CREATE OR REPLACE FUNCTION piggyvest_primary.read_pending_savings(scope jsonb, goal_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE recovered jsonb;
BEGIN
  IF scope IS NULL OR jsonb_typeof(scope)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(scope))<>6 THEN
    RAISE EXCEPTION 'invalid savings scope' USING ERRCODE='42501';
  END IF;
  -- Lock the binding, authority, customer and goal rows. reserve_savings takes
  -- the goal FOR UPDATE, which conflicts with this FOR SHARE, so a reservation
  -- cannot commit between the ownership, unattributed and read statements
  -- below; under READ COMMITTED it either finished before or waits for us.
  PERFORM 1 FROM piggyvest_primary.integrations binding
    JOIN piggyvest_primary.savings_authorities authority ON authority.integration_id=binding.id
    JOIN public.customers customer ON customer.merchant_id=binding.merchant_id
    JOIN public.customer_savings_goals goal ON goal.customer_id=customer.id AND goal.merchant_id=customer.merchant_id
    WHERE binding.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
      AND binding.id=(scope->>'integrationId')::uuid
      AND binding.merchant_id=(scope->>'merchantId')::uuid
      AND binding.business_id=scope->>'businessId' AND binding.environment=scope->>'environment'
      AND customer.id=(scope->>'customerId')::uuid AND customer.user_id=(scope->>'userId')::uuid
      AND goal.id=read_pending_savings.goal_id
    FOR SHARE OF binding,authority,customer,goal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'savings recovery ownership unavailable' USING ERRCODE='42501';
  END IF;
  -- The answer must be definite. Any reserved or dispatched transfer on this
  -- goal that the scoped read cannot attribute (for example one made under
  -- another integration of the same merchant before a cutover, or one with no
  -- intent) leaves the in-flight set unknown, even when an attributable one
  -- also exists, so refuse instead of letting the client act on a partial view.
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.savings_operations operation
    WHERE operation.goal_id=read_pending_savings.goal_id
      AND operation.state IN ('reserved','dispatched')
      AND NOT EXISTS (
        SELECT 1 FROM piggyvest_primary.onboarding_intents intent
        WHERE intent.id=operation.intent_id
          AND intent.integration_id=operation.integration_id
          AND operation.integration_id=(scope->>'integrationId')::uuid
          AND intent.merchant_id=(scope->>'merchantId')::uuid
          AND intent.customer_id=(scope->>'customerId')::uuid
          AND intent.user_id=(scope->>'userId')::uuid)
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
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.read_pending_savings(jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_pending_savings(jsonb,uuid) TO piggyvest_primary_authorizer;
COMMIT;

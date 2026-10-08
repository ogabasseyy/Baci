BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.read_pending_savings(scope jsonb,goal_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE resolved_intent_id uuid:=piggyvest_primary.assert_savings_scope(scope); recovered jsonb;
BEGIN
  SELECT jsonb_build_object('operationId',operation.id,'goalId',operation.goal_id,
    'amountKobo',operation.amount_kobo,'state',operation.state) INTO recovered
  FROM piggyvest_primary.savings_operations operation
  JOIN public.customer_savings_goals goal ON goal.id=operation.goal_id
  WHERE operation.intent_id=resolved_intent_id
    AND operation.integration_id=(scope->>'integrationId')::uuid
    AND operation.goal_id=read_pending_savings.goal_id
    AND goal.customer_id=(scope->>'customerId')::uuid
    AND goal.merchant_id=(scope->>'merchantId')::uuid
    AND operation.state IN ('reserved','dispatched')
  ORDER BY operation.created_at,operation.id LIMIT 1;
  RETURN recovered;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.read_pending_savings(jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_pending_savings(jsonb,uuid) TO piggyvest_primary_authorizer;
COMMIT;

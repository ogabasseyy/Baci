BEGIN;

CREATE OR REPLACE FUNCTION public.get_customer_savings_earnings(p_merchant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  customer uuid;
  deployment_environment_value text;
  earnings numeric;
BEGIN
  customer := savings_notifications.customer_for(p_merchant_id);
  deployment_environment_value := savings_interest_private.require_environment();

  IF deployment_environment_value = 'staging' THEN
    SELECT coalesce(sum(posting.amount_kobo), 0)::numeric INTO earnings
    FROM piggyvest_savings_ledger.operations operation
    JOIN piggyvest_savings_ledger.postings posting
      ON posting.operation_id = operation.id
      AND posting.account = 'paid_interest'
    LEFT JOIN piggyvest_savings_ledger.operations original
      ON original.id = operation.reference_id
      AND original.integration_id = operation.integration_id
      AND original.merchant_id = operation.merchant_id
      AND original.customer_id = operation.customer_id
      AND original.goal_id = operation.goal_id
    WHERE operation.merchant_id = p_merchant_id
      AND operation.customer_id = customer
      AND (
        (operation.command->>'kind' = 'credit_eligible_paid_interest'
          AND posting.amount_kobo > 0)
        OR (operation.command->>'kind' = 'reverse_credit'
          AND original.command->>'kind' = 'credit_eligible_paid_interest'
          AND posting.amount_kobo < 0)
      );
  ELSE
    SELECT coalesce(sum(interest.amount), 0)::numeric INTO earnings
    FROM piggyvest_primary.customer_paid_interest(p_merchant_id, customer) interest;
  END IF;

  IF earnings NOT BETWEEN 0 AND 9007199254740991 THEN
    RAISE EXCEPTION 'Earnings outside safe range' USING ERRCODE = '22003';
  END IF;
  RETURN jsonb_build_object('credited_interest_kobo', earnings);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_savings_earnings(
  p_merchant_id uuid,
  p_include_goals boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  customer uuid;
  deployment_environment_value text;
  result jsonb;
  goals jsonb;
BEGIN
  customer := savings_notifications.customer_for(p_merchant_id);
  deployment_environment_value := savings_interest_private.require_environment();
  result := public.get_customer_savings_earnings(p_merchant_id);
  IF p_include_goals IS NOT TRUE THEN
    RETURN result;
  END IF;

  IF deployment_environment_value = 'staging' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'goal_id', balance.goal_id,
      'credited_interest_kobo', balance.amount
    ) ORDER BY balance.goal_id), '[]'::jsonb) INTO goals
    FROM (
      SELECT operation.goal_id, sum(posting.amount_kobo)::numeric AS amount
      FROM piggyvest_savings_ledger.operations operation
      JOIN piggyvest_savings_ledger.postings posting
        ON posting.operation_id = operation.id
        AND posting.account = 'paid_interest'
      LEFT JOIN piggyvest_savings_ledger.operations original
        ON original.id = operation.reference_id
        AND original.integration_id = operation.integration_id
        AND original.merchant_id = operation.merchant_id
        AND original.customer_id = operation.customer_id
        AND original.goal_id = operation.goal_id
      JOIN public.customer_savings_goals goal
        ON goal.id = operation.goal_id
        AND goal.merchant_id = operation.merchant_id
        AND goal.customer_id = operation.customer_id
      WHERE operation.merchant_id = p_merchant_id
        AND operation.customer_id = customer
        AND goal.status IN ('active', 'paused', 'completed')
        AND (
          (operation.command->>'kind' = 'credit_eligible_paid_interest'
            AND posting.amount_kobo > 0)
          OR (operation.command->>'kind' = 'reverse_credit'
            AND original.command->>'kind' = 'credit_eligible_paid_interest'
            AND posting.amount_kobo < 0)
        )
      GROUP BY operation.goal_id
    ) balance;
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'goal_id', balance.goal_id,
      'credited_interest_kobo', balance.amount
    ) ORDER BY balance.goal_id), '[]'::jsonb) INTO goals
    FROM (
      SELECT interest.goal_id, sum(interest.amount)::numeric AS amount
      FROM piggyvest_primary.customer_paid_interest(p_merchant_id, customer) interest
      JOIN public.customer_savings_goals goal
        ON goal.id = interest.goal_id
        AND goal.merchant_id = p_merchant_id
        AND goal.customer_id = customer
      WHERE goal.status IN ('active', 'paused', 'completed')
      GROUP BY interest.goal_id
    ) balance;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(goals) item
    WHERE (item->>'credited_interest_kobo')::numeric
      NOT BETWEEN 0 AND 9007199254740991
  ) THEN
    RAISE EXCEPTION 'Goal interest outside safe range' USING ERRCODE = '22003';
  END IF;
  RETURN result || jsonb_build_object('goal_interest_kobo', goals);
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_savings_earnings(uuid),
  public.get_customer_savings_earnings(uuid, boolean)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_savings_earnings(uuid),
  public.get_customer_savings_earnings(uuid, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.get_customer_savings_earnings(uuid) IS
  'Returns authenticated customer paid-interest earnings from the owner-provisioned environment ledger. Staging totals include only eligible paid-interest credits and their linked reversals, excluding purchase and reservation postings.';
COMMENT ON FUNCTION public.get_customer_savings_earnings(uuid, boolean) IS
  'Returns authenticated customer paid-interest earnings and optional per-goal totals using the same environment ledger and eligible credit/reversal semantics.';

COMMIT;

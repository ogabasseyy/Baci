BEGIN;

-- The deployment environment is intentionally unset on every new install.
-- It must be provisioned once by the database owner for each database.
CREATE SCHEMA savings_interest_private;
REVOKE ALL ON SCHEMA savings_interest_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE savings_interest_private.deployment_environment (
  singleton boolean PRIMARY KEY CHECK (singleton),
  environment text NOT NULL CHECK (environment IN ('staging', 'production'))
);
ALTER TABLE savings_interest_private.deployment_environment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE savings_interest_private.deployment_environment
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION savings_interest_private.reject_environment_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'savings interest environment is write-once' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER savings_interest_environment_write_once
  BEFORE UPDATE OR DELETE ON savings_interest_private.deployment_environment
  FOR EACH ROW EXECUTE FUNCTION savings_interest_private.reject_environment_change();
CREATE TRIGGER savings_interest_environment_no_truncate
  BEFORE TRUNCATE ON savings_interest_private.deployment_environment
  FOR EACH STATEMENT EXECUTE FUNCTION savings_interest_private.reject_environment_change();

CREATE FUNCTION savings_interest_private.require_environment()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE configured_environment text;
BEGIN
  SELECT environment INTO configured_environment
  FROM savings_interest_private.deployment_environment
  WHERE singleton;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'savings interest environment is not configured' USING ERRCODE = '55000';
  END IF;
  RETURN configured_environment;
END;
$$;
REVOKE ALL ON FUNCTION savings_interest_private.reject_environment_change(),
  savings_interest_private.require_environment() FROM PUBLIC, anon, authenticated, service_role;

-- Existing reversals have no provider or database occurrence timestamp. Keep
-- them NULL; this records only when a future reversal is observed locally.
ALTER TABLE piggyvest_primary.paid_interest_reversals
  ADD COLUMN recorded_at timestamptz;

CREATE FUNCTION piggyvest_primary.stamp_interest_reversal_observation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER primary_interest_reversal_observed
  BEFORE INSERT ON piggyvest_primary.paid_interest_reversals
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.stamp_interest_reversal_observation();

REVOKE ALL ON FUNCTION piggyvest_primary.stamp_interest_reversal_observation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION savings_interest_private.get_customer_savings_interest_history(p_merchant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  customer uuid;
  deployment_environment_value text;
  history jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authenticated customer required' USING ERRCODE = '42501';
  END IF;
  customer := savings_notifications.customer_for(p_merchant_id);
  deployment_environment_value := savings_interest_private.require_environment();

  -- Select exactly the ledger belonging to this database's owner-provisioned
  -- environment. The marker is absent until an operator provisions it.
  WITH activity AS (
    SELECT
      'primary:' || receipt.integration_id::text || ':' || receipt.payout_id AS id,
      receipt.goal_id AS goal_id,
      receipt.net_kobo::numeric / 100 AS amount,
      'credit'::text AS type,
      'Paid savings interest'::text AS description,
      'received'::text AS date_basis,
      receipt.received_at AS created_at
    FROM piggyvest_primary.paid_interest_receipts receipt
    JOIN piggyvest_primary.integrations integration
      ON integration.id = receipt.integration_id
      AND integration.merchant_id = receipt.merchant_id
      AND integration.environment = 'production'
    JOIN public.customer_savings_goals goal
      ON goal.id = receipt.goal_id
      AND goal.merchant_id = receipt.merchant_id
      AND goal.customer_id = receipt.customer_id
    WHERE deployment_environment_value = 'production'
      AND receipt.merchant_id = p_merchant_id
      AND receipt.customer_id = customer
      AND receipt.net_kobo > 0

    UNION ALL

    SELECT
      'primary-reversal:' || reversal.integration_id::text || ':' || reversal.provider_reversal_id,
      receipt.goal_id,
      -(reversal.amount_kobo::numeric / 100),
      'adjustment'::text,
      'Paid savings interest reversal'::text,
      CASE WHEN reversal.recorded_at IS NULL THEN 'unknown' ELSE 'observed' END,
      reversal.recorded_at
    FROM piggyvest_primary.paid_interest_reversals reversal
    JOIN piggyvest_primary.paid_interest_receipts receipt
      ON receipt.integration_id = reversal.integration_id
      AND receipt.payout_id = reversal.payout_id
    JOIN piggyvest_primary.integrations integration
      ON integration.id = receipt.integration_id
      AND integration.merchant_id = receipt.merchant_id
      AND integration.environment = 'production'
    JOIN public.customer_savings_goals goal
      ON goal.id = receipt.goal_id
      AND goal.merchant_id = receipt.merchant_id
      AND goal.customer_id = receipt.customer_id
    WHERE deployment_environment_value = 'production'
      AND receipt.merchant_id = p_merchant_id
      AND receipt.customer_id = customer

    UNION ALL

    SELECT
      'legacy:' || operation.id::text,
      operation.goal_id,
      posting.amount_kobo::numeric / 100,
      CASE WHEN posting.amount_kobo < 0 THEN 'adjustment' ELSE 'credit' END,
      CASE WHEN posting.amount_kobo < 0 THEN 'Paid savings interest reversal' ELSE 'Paid savings interest' END,
      'ledger'::text,
      operation.created_at
    FROM piggyvest_savings_ledger.operations operation
    JOIN piggyvest_savings_ledger.postings posting
      ON posting.operation_id = operation.id AND posting.account = 'paid_interest'
    JOIN public.customer_savings_goals goal
      ON goal.id = operation.goal_id
      AND goal.merchant_id = operation.merchant_id
      AND goal.customer_id = operation.customer_id
    WHERE deployment_environment_value = 'staging'
      AND operation.merchant_id = p_merchant_id
      AND operation.customer_id = customer
      AND operation.command->>'kind' IN ('credit_eligible_paid_interest', 'reverse_credit')
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', activity.id,
        'goal_id', activity.goal_id,
        'amount', activity.amount,
        'type', activity.type,
        'description', activity.description,
        'date_basis', activity.date_basis,
        'source_type', 'savings_interest',
        'created_at', activity.created_at
      ) ORDER BY activity.created_at DESC NULLS LAST, activity.id
    ),
    '[]'::jsonb
  ) INTO history
  FROM (SELECT * FROM activity ORDER BY created_at DESC NULLS LAST, id LIMIT 20) activity;

  RETURN jsonb_build_object('interest_history', history);
END;
$$;

CREATE FUNCTION public.get_customer_savings_interest_history(p_merchant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  SELECT savings_interest_private.get_customer_savings_interest_history(p_merchant_id);
$$;

REVOKE ALL ON FUNCTION savings_interest_private.get_customer_savings_interest_history(uuid)
  FROM PUBLIC, anon, service_role;
GRANT USAGE ON SCHEMA savings_interest_private TO authenticated;
GRANT EXECUTE ON FUNCTION savings_interest_private.get_customer_savings_interest_history(uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.get_customer_savings_interest_history(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_savings_interest_history(uuid)
  TO authenticated;

COMMENT ON FUNCTION savings_interest_private.get_customer_savings_interest_history(uuid) IS
  'Returns up to 20 paid-interest credits and reversals from the single owner-provisioned environment ledger for the authenticated customer linked to the supplied merchant. Unconfigured databases fail closed. Staging legacy ledger activity uses ledger recorded_at; primary reversal timestamps remain NULL for historical rows and recorded_at applies only to new observations.';
COMMENT ON FUNCTION public.get_customer_savings_interest_history(uuid) IS
  'Security-invoker RPC wrapper for the authenticated customer interest-history helper.';

CREATE OR REPLACE FUNCTION public.get_customer_savings_earnings(p_merchant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE customer uuid; deployment_environment_value text; earnings numeric;
BEGIN
  customer := savings_notifications.customer_for(p_merchant_id);
  deployment_environment_value := savings_interest_private.require_environment();
  IF deployment_environment_value = 'staging' THEN
    SELECT coalesce(sum(posting.amount_kobo), 0)::numeric INTO earnings
    FROM piggyvest_savings_ledger.operations operation
    JOIN piggyvest_savings_ledger.postings posting
      ON posting.operation_id = operation.id AND posting.account = 'paid_interest'
    WHERE operation.merchant_id = p_merchant_id AND operation.customer_id = customer;
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

CREATE OR REPLACE FUNCTION public.get_customer_savings_earnings(p_merchant_id uuid, p_include_goals boolean)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE customer uuid; deployment_environment_value text; result jsonb; goals jsonb;
BEGIN
  customer := savings_notifications.customer_for(p_merchant_id);
  deployment_environment_value := savings_interest_private.require_environment();
  result := public.get_customer_savings_earnings(p_merchant_id);
  IF p_include_goals IS NOT TRUE THEN RETURN result; END IF;
  IF deployment_environment_value = 'staging' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'goal_id', balance.goal_id, 'credited_interest_kobo', balance.amount
    ) ORDER BY balance.goal_id), '[]'::jsonb) INTO goals
    FROM (
      SELECT operation.goal_id, sum(posting.amount_kobo)::numeric AS amount
      FROM piggyvest_savings_ledger.operations operation
      JOIN piggyvest_savings_ledger.postings posting
        ON posting.operation_id = operation.id AND posting.account = 'paid_interest'
      JOIN public.customer_savings_goals goal
        ON goal.id = operation.goal_id AND goal.merchant_id = operation.merchant_id
        AND goal.customer_id = operation.customer_id
      WHERE operation.merchant_id = p_merchant_id AND operation.customer_id = customer
        AND goal.status IN ('active', 'paused', 'completed')
      GROUP BY operation.goal_id
    ) balance;
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'goal_id', balance.goal_id, 'credited_interest_kobo', balance.amount
    ) ORDER BY balance.goal_id), '[]'::jsonb) INTO goals
    FROM (
      SELECT interest.goal_id, sum(interest.amount)::numeric AS amount
      FROM piggyvest_primary.customer_paid_interest(p_merchant_id, customer) interest
      JOIN public.customer_savings_goals goal ON goal.id = interest.goal_id
        AND goal.merchant_id = p_merchant_id AND goal.customer_id = customer
      WHERE goal.status IN ('active', 'paused', 'completed')
      GROUP BY interest.goal_id
    ) balance;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(goals) item
    WHERE (item->>'credited_interest_kobo')::numeric NOT BETWEEN 0 AND 9007199254740991) THEN
    RAISE EXCEPTION 'Goal interest outside safe range' USING ERRCODE = '22003';
  END IF;
  RETURN result || jsonb_build_object('goal_interest_kobo', goals);
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_savings_earnings(uuid),
  public.get_customer_savings_earnings(uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_savings_earnings(uuid),
  public.get_customer_savings_earnings(uuid, boolean) TO authenticated;

COMMENT ON TABLE savings_interest_private.deployment_environment IS
  'Write-once private RLS-protected environment marker. Deliberately empty after migration; earnings/history return unavailable until the database owner inserts staging or production for this database. This is an operational deployment gate; migrations never infer or provision the value.';

COMMIT;

BEGIN;
CREATE FUNCTION public.get_customer_savings_interest_accrual_observations(p_merchant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE resolved_customer_id uuid; observations jsonb; has_more boolean;
BEGIN
  resolved_customer_id := savings_notifications.customer_for(p_merchant_id);
  WITH latest AS MATERIALIZED (
    SELECT observation.id, observation.goal_id, observation.interest_date,
      observation.observed_at, observation.interest_type, observation.amount_lexeme
    FROM piggyvest_staging.interest_accrual_observations observation
    JOIN public.customer_savings_goals goal ON goal.id = observation.goal_id
      AND goal.merchant_id = observation.merchant_id AND goal.customer_id = observation.customer_id
    WHERE observation.merchant_id = p_merchant_id AND observation.customer_id = resolved_customer_id
      AND observation.interest_type = 'original'
    ORDER BY observation.interest_date DESC, observation.id LIMIT 101
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('observationId', observation.id,
    'goalId', observation.goal_id, 'interestDate', observation.interest_date,
    'observedAt', observation.observed_at, 'interestType', observation.interest_type,
    'amountKobo', observation.amount_lexeme, 'currency', 'NGN', 'spendable', false)
    ORDER BY observation.interest_date DESC, observation.id), '[]'::jsonb),
    (SELECT count(*) > 100 FROM latest) INTO observations, has_more
  FROM (SELECT id, goal_id, interest_date, observed_at, interest_type, amount_lexeme
    FROM latest ORDER BY interest_date DESC, id LIMIT 100) observation;
  RETURN jsonb_build_object('observations', observations, 'spendable', false, 'hasMore', has_more);
END $$;
REVOKE ALL ON FUNCTION public.get_customer_savings_interest_accrual_observations(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_savings_interest_accrual_observations(uuid) TO authenticated;
COMMENT ON FUNCTION public.get_customer_savings_interest_accrual_observations(uuid) IS
  'Authenticated latest 100 dated original-interest observations for the current undeleted customer in one merchant; hasMore reports omitted observations, not an amount. Fractional kobo stays decimal text. Observations are nonspendable and are not a reconciled unpaid aggregate, paid Earnings, or a payout allocation.';
COMMIT;

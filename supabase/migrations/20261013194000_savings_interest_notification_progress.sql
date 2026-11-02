BEGIN;

CREATE FUNCTION savings_notifications.progress_message(p_saved_kobo numeric, p_target_kobo numeric)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE progress integer;
BEGIN
  IF p_saved_kobo IS NULL OR p_target_kobo IS NULL OR p_saved_kobo < 0
    OR p_target_kobo <= 0 OR p_saved_kobo::text IN ('NaN','Infinity','-Infinity')
    OR p_target_kobo::text IN ('NaN','Infinity','-Infinity') THEN
    RETURN 'Open your savings to see your latest balance.';
  END IF;
  IF p_saved_kobo >= p_target_kobo THEN
    RETURN 'Goal reached! 🎉';
  END IF;
  progress := floor(p_saved_kobo * 100 / p_target_kobo)::integer;
  IF progress > 0 THEN
    RETURN 'You’re now ' || progress || '% of the way there.';
  END IF;
  RETURN '₦' || to_char((p_target_kobo - p_saved_kobo) / 100,
    'FM999,999,999,999,990.00') || ' left to reach your goal.';
END $$;

CREATE FUNCTION savings_notifications.interest_progress(p_goal uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog AS $$
DECLARE goal public.customer_savings_goals%ROWTYPE; credited numeric; primary_credited numeric;
BEGIN
  SELECT scoped.* INTO goal FROM public.customer_savings_goals scoped WHERE scoped.id = p_goal;
  IF NOT FOUND THEN RETURN savings_notifications.progress_message(NULL, NULL); END IF;
  SELECT coalesce(sum(posting.amount_kobo), 0) INTO credited
  FROM piggyvest_savings_ledger.postings posting
  JOIN piggyvest_savings_ledger.operations operation ON operation.id = posting.operation_id
  WHERE operation.goal_id = goal.id AND operation.merchant_id = goal.merchant_id
    AND operation.customer_id = goal.customer_id AND posting.account = 'paid_interest';
  SELECT coalesce(sum(receipt.net_kobo - coalesce(reversal.amount, 0)), 0) INTO primary_credited
  FROM piggyvest_primary.paid_interest_receipts receipt
  LEFT JOIN LATERAL (
    SELECT sum(reversed.amount_kobo) AS amount FROM piggyvest_primary.paid_interest_reversals reversed
    WHERE reversed.integration_id = receipt.integration_id AND reversed.payout_id = receipt.payout_id
  ) reversal ON true
  WHERE receipt.goal_id = goal.id AND receipt.merchant_id = goal.merchant_id
    AND receipt.customer_id = goal.customer_id;
  RETURN savings_notifications.progress_message(goal.current_amount * 100 + credited + primary_credited,
    goal.target_amount * 100);
END $$;

REVOKE ALL ON FUNCTION savings_notifications.progress_message(numeric,numeric),
  savings_notifications.interest_progress(uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE signature regprocedure; definition text; goal_expression text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'piggyvest_primary.notify_paid_interest()'::regprocedure,
    'savings_notifications.interest_recorded()'::regprocedure
  ] LOOP
    definition := pg_get_functiondef(signature);
    IF strpos(definition, ' interest added to your savings. Another step closer to your goal.') = 0 THEN
      RAISE EXCEPTION 'Unexpected interest notification progress baseline';
    END IF;
    goal_expression := CASE WHEN signature = 'piggyvest_primary.notify_paid_interest()'::regprocedure
      THEN 'NEW.goal_id' ELSE 'operation.goal_id' END;
    EXECUTE replace(definition,
      quote_literal(' interest added to your savings. Another step closer to your goal.'),
      quote_literal(' interest added to your savings. ') ||
      ' || savings_notifications.interest_progress(' || goal_expression || ')');
  END LOOP;
END $$;

COMMIT;

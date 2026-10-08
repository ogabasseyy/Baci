BEGIN;
CREATE FUNCTION piggyvest_primary.customer_paid_interest(p_merchant uuid,p_customer uuid)
RETURNS TABLE(goal_id uuid,amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT receipt.goal_id,sum(receipt.net_kobo-coalesce(reversal.amount,0))::numeric
  FROM piggyvest_primary.paid_interest_receipts receipt
  JOIN piggyvest_primary.integrations integration ON integration.id=receipt.integration_id AND integration.environment='production'
    AND integration.merchant_id=receipt.merchant_id
  JOIN public.customer_savings_goals goal ON goal.id=receipt.goal_id AND goal.merchant_id=receipt.merchant_id AND goal.customer_id=receipt.customer_id
  LEFT JOIN LATERAL (SELECT sum(amount_kobo)::numeric AS amount FROM piggyvest_primary.paid_interest_reversals
    WHERE integration_id=receipt.integration_id AND payout_id=receipt.payout_id) reversal ON true
  WHERE receipt.merchant_id=p_merchant AND receipt.customer_id=p_customer
  GROUP BY receipt.goal_id;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_savings_earnings(p_merchant_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE customer uuid; earnings numeric; primary_earnings numeric;
BEGIN
  customer:=savings_notifications.customer_for(p_merchant_id);
  SELECT coalesce(sum(CASE
    WHEN operation.command->>'kind'='credit_eligible_paid_interest' THEN (operation.command->>'interestKobo')::numeric
    WHEN operation.command->>'kind'='reverse_credit' AND original.command->>'kind'='credit_eligible_paid_interest'
      THEN -(original.command->>'interestKobo')::numeric ELSE 0 END),0) INTO earnings
  FROM piggyvest_savings_ledger.operations operation
  LEFT JOIN piggyvest_savings_ledger.operations original ON original.id=operation.reference_id
    AND original.customer_id=operation.customer_id AND original.merchant_id=operation.merchant_id
  WHERE operation.merchant_id=p_merchant_id AND operation.customer_id=customer;
  SELECT coalesce(sum(amount),0) INTO primary_earnings FROM piggyvest_primary.customer_paid_interest(p_merchant_id,customer);
  earnings:=earnings+primary_earnings;
  IF earnings NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Earnings outside safe range' USING ERRCODE='22003'; END IF;
  RETURN jsonb_build_object('credited_interest_kobo',earnings);
END $$;

CREATE OR REPLACE FUNCTION public.get_customer_savings_earnings(p_merchant_id uuid,p_include_goals boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE customer uuid; result jsonb; goals jsonb;
BEGIN
  customer:=savings_notifications.customer_for(p_merchant_id);
  result:=public.get_customer_savings_earnings(p_merchant_id);
  IF p_include_goals IS NOT TRUE THEN RETURN result; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('goal_id',balance.goal_id,'credited_interest_kobo',balance.amount)
    ORDER BY balance.goal_id),'[]'::jsonb) INTO goals
  FROM (
    SELECT combined.goal_id,sum(combined.amount)::numeric AS amount FROM (
      SELECT operation.goal_id,posting.amount_kobo::numeric AS amount
      FROM piggyvest_savings_ledger.postings posting
      JOIN piggyvest_savings_ledger.operations operation ON operation.id=posting.operation_id
      WHERE operation.merchant_id=p_merchant_id AND operation.customer_id=customer AND posting.account='paid_interest'
      UNION ALL
      SELECT primary_interest.goal_id,primary_interest.amount FROM piggyvest_primary.customer_paid_interest(p_merchant_id,customer) primary_interest
    ) combined
    JOIN public.customer_savings_goals goal ON goal.id=combined.goal_id AND goal.merchant_id=p_merchant_id AND goal.customer_id=customer
    WHERE goal.status IN ('active','paused','completed') GROUP BY combined.goal_id
  ) balance;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(goals) item
    WHERE (item->>'credited_interest_kobo')::numeric NOT BETWEEN 0 AND 9007199254740991) THEN
    RAISE EXCEPTION 'Goal interest outside safe range' USING ERRCODE='22003';
  END IF;
  RETURN result||jsonb_build_object('goal_interest_kobo',goals);
END $$;

CREATE FUNCTION piggyvest_primary.notify_paid_interest()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.net_kobo>0 THEN
    PERFORM savings_notifications.emit(NEW.goal_id,'primary-interest:'||NEW.integration_id::text||':'||NEW.payout_id,
      'interest_credited','Your savings earned interest',
      'Your savings grew by ₦'||to_char(NEW.net_kobo::numeric/100,'FM999,999,999,999,990.00')||' in paid interest. Keep going!');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_paid_interest_notification AFTER INSERT ON piggyvest_primary.paid_interest_receipts
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.notify_paid_interest();
CREATE FUNCTION piggyvest_primary.void_paid_interest_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  UPDATE savings_notifications.events event SET voided_at=coalesce(event.voided_at,clock_timestamp())
  FROM piggyvest_primary.paid_interest_receipts receipt
  WHERE receipt.integration_id=NEW.integration_id AND receipt.payout_id=NEW.payout_id
    AND event.merchant_id=receipt.merchant_id AND event.customer_id=receipt.customer_id AND event.goal_id=receipt.goal_id
    AND event.event_key='primary-interest:'||NEW.integration_id::text||':'||NEW.payout_id;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_paid_interest_notification_reversal AFTER INSERT ON piggyvest_primary.paid_interest_reversals
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.void_paid_interest_notification();
CREATE FUNCTION piggyvest_primary.guard_legacy_interest_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation piggyvest_savings_ledger.operations%ROWTYPE;
BEGIN
  IF NEW.account NOT IN ('paid_interest','purchase_interest') THEN RETURN NEW; END IF;
  SELECT * INTO STRICT operation FROM piggyvest_savings_ledger.operations WHERE id=NEW.operation_id;
  PERFORM id FROM public.customer_savings_goals WHERE id=operation.goal_id AND merchant_id=operation.merchant_id
    AND customer_id=operation.customer_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.paid_interest_receipts WHERE goal_id=operation.goal_id
    AND merchant_id=operation.merchant_id AND customer_id=operation.customer_id) THEN
    RAISE EXCEPTION 'production primary interest source is exclusive; reconciliation required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_interest_source_exclusive BEFORE INSERT ON piggyvest_savings_ledger.postings
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.guard_legacy_interest_source();
REVOKE ALL ON FUNCTION piggyvest_primary.customer_paid_interest(uuid,uuid),piggyvest_primary.notify_paid_interest(),
  piggyvest_primary.void_paid_interest_notification(),piggyvest_primary.guard_legacy_interest_source() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_customer_savings_earnings(uuid),public.get_customer_savings_earnings(uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_savings_earnings(uuid),public.get_customer_savings_earnings(uuid,boolean) TO authenticated;
COMMIT;

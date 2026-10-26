BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.notify_paid_interest()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.net_kobo>0 THEN
    PERFORM savings_notifications.emit(NEW.goal_id,'primary-interest:'||NEW.integration_id::text||':'||NEW.payout_id,
      'interest_credited','Your savings just grew 🎉',
      '₦'||to_char(NEW.net_kobo::numeric/100,'FM999,999,999,999,990.00')||' interest added to your plan. Another step closer to your goal.');
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION savings_notifications.interest_recorded() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE operation piggyvest_savings_ledger.operations%ROWTYPE;
BEGIN
  IF NEW.account <> 'paid_interest' THEN RETURN NEW; END IF;
  SELECT * INTO STRICT operation FROM piggyvest_savings_ledger.operations WHERE id = NEW.operation_id;
  IF operation.command->>'kind' = 'credit_eligible_paid_interest' AND NEW.amount_kobo > 0 THEN
    PERFORM savings_notifications.emit(operation.goal_id, 'interest:' || operation.id, 'interest_credited',
      'Your savings just grew 🎉', '₦' || to_char(NEW.amount_kobo::numeric / 100, 'FM999,999,999,999,990.00') ||
      ' interest added to your plan. Another step closer to your goal.');
  ELSIF operation.command->>'kind' = 'reverse_credit' AND NEW.amount_kobo < 0 THEN
    UPDATE savings_notifications.events SET voided_at = now()
      WHERE merchant_id = operation.merchant_id AND customer_id = operation.customer_id
      AND goal_id = operation.goal_id AND event_key = 'interest:' || operation.reference_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.notify_paid_interest(),savings_notifications.interest_recorded()
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;

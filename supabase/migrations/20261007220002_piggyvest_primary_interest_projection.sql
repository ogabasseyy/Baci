BEGIN;
ALTER FUNCTION piggyvest_primary.completion_totals(uuid,uuid,uuid) RENAME TO completion_totals_before_production_interest;
REVOKE ALL ON FUNCTION piggyvest_primary.completion_totals_before_production_interest(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION piggyvest_primary.completion_totals(p_goal uuid,p_merchant uuid,p_customer uuid)
RETURNS TABLE(integration_id uuid,paid_interest_kobo numeric,pending_kobo numeric,pending_ids uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT totals.integration_id,
    CASE WHEN integration.environment='production' THEN
      coalesce((SELECT sum(receipt.net_kobo) FROM piggyvest_primary.paid_interest_receipts receipt
        WHERE receipt.integration_id=totals.integration_id AND receipt.goal_id=p_goal AND receipt.merchant_id=p_merchant AND receipt.customer_id=p_customer),0)
      -coalesce((SELECT sum(reversal.amount_kobo) FROM piggyvest_primary.paid_interest_reversals reversal
        JOIN piggyvest_primary.paid_interest_receipts receipt ON receipt.integration_id=reversal.integration_id AND receipt.payout_id=reversal.payout_id
        WHERE receipt.integration_id=totals.integration_id AND receipt.goal_id=p_goal AND receipt.merchant_id=p_merchant AND receipt.customer_id=p_customer),0)
    ELSE totals.paid_interest_kobo END,totals.pending_kobo,totals.pending_ids
  FROM piggyvest_primary.completion_totals_before_production_interest(p_goal,p_merchant,p_customer) totals
  JOIN piggyvest_primary.integrations integration ON integration.id=totals.integration_id;
$$;
CREATE FUNCTION piggyvest_primary.guard_paid_interest_reversal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE net numeric; reversed numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('primary-interest:'||NEW.integration_id::text||':'||NEW.payout_id,0));
  SELECT net_kobo INTO net FROM piggyvest_primary.paid_interest_receipts WHERE integration_id=NEW.integration_id AND payout_id=NEW.payout_id FOR UPDATE;
  SELECT coalesce(sum(amount_kobo),0) INTO reversed FROM piggyvest_primary.paid_interest_reversals WHERE integration_id=NEW.integration_id AND payout_id=NEW.payout_id;
  IF net IS NULL OR reversed+NEW.amount_kobo>net THEN RAISE EXCEPTION 'interest reversal exceeds verified net payout' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_interest_reversal_guard BEFORE INSERT ON piggyvest_primary.paid_interest_reversals
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.guard_paid_interest_reversal();
CREATE FUNCTION piggyvest_primary.refresh_reversed_paid_interest()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  UPDATE public.customer_savings_goals goal SET status=goal.status
    FROM piggyvest_primary.paid_interest_receipts receipt
    WHERE receipt.integration_id=NEW.integration_id AND receipt.payout_id=NEW.payout_id
      AND goal.id=receipt.goal_id AND goal.merchant_id=receipt.merchant_id AND goal.customer_id=receipt.customer_id;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_interest_reversal_refresh AFTER INSERT ON piggyvest_primary.paid_interest_reversals
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.refresh_reversed_paid_interest();
REVOKE ALL ON FUNCTION piggyvest_primary.completion_totals(uuid,uuid,uuid),piggyvest_primary.guard_paid_interest_reversal(),
  piggyvest_primary.refresh_reversed_paid_interest() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;

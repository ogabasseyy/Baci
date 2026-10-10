BEGIN;

CREATE FUNCTION piggyvest_savings_ledger.guard_prefunded_interest_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE goal public.customer_savings_goals%ROWTYPE; pending numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.collection_status <> 'dispatching'
    OR OLD.collection_status = 'dispatching') THEN RETURN NEW; END IF;
  SELECT saved.id, saved.merchant_id, saved.customer_id, saved.target_amount, saved.current_amount,
    saved.status INTO goal.id, goal.merchant_id, goal.customer_id, goal.target_amount, goal.current_amount, goal.status
  FROM public.customer_savings_goals saved WHERE saved.id = NEW.goal_id
    AND saved.merchant_id = NEW.merchant_id AND saved.customer_id = NEW.customer_id FOR UPDATE;
  IF NOT FOUND OR goal.status <> 'active' THEN
    RAISE EXCEPTION 'prefunded card goal capacity insufficient' USING ERRCODE = '23514';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'savings completion requires read committed' USING ERRCODE = '25000';
  END IF;
  SELECT coalesce(sum(operation.amount_kobo), 0) INTO pending FROM prefunded_card.operations operation
    WHERE operation.goal_id = goal.id AND operation.id <> NEW.id
      AND operation.collection_status NOT IN ('verified_failed','reversed') AND operation.projection_status <> 'applied';
  IF NEW.amount_kobo + pending > piggyvest_savings_ledger.remaining_goal_kobo(
    goal.id, goal.merchant_id, goal.customer_id, goal.target_amount, goal.current_amount) THEN
    RAISE EXCEPTION 'prefunded card goal capacity insufficient' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION piggyvest_savings_ledger.guard_prefunded_interest_capacity()
  FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
  IF to_regclass('prefunded_card.operations') IS NOT NULL THEN
    EXECUTE 'CREATE TRIGGER prefunded_paid_interest_capacity BEFORE INSERT OR UPDATE OF collection_status
      ON prefunded_card.operations FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_ledger.guard_prefunded_interest_capacity()';
  END IF;
END $$;


COMMIT;


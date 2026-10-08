BEGIN;

CREATE FUNCTION piggyvest_savings_ledger.remaining_goal_kobo(
  p_goal uuid, p_merchant uuid, p_customer uuid, p_target numeric, p_principal numeric
) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT greatest(0, (p_target - p_principal) * 100 - coalesce(sum(posting.amount_kobo), 0))
  FROM piggyvest_savings_ledger.postings posting
  JOIN piggyvest_savings_ledger.operations operation ON operation.id = posting.operation_id
  WHERE operation.goal_id = p_goal AND operation.merchant_id = p_merchant
    AND operation.customer_id = p_customer AND posting.account = 'paid_interest';
$$;

CREATE FUNCTION piggyvest_savings_ledger.guard_goal_interest_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE remaining numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM piggyvest_savings_ledger.bindings binding
    WHERE binding.goal_id = NEW.id AND binding.merchant_id = NEW.merchant_id
      AND binding.customer_id = NEW.customer_id) THEN RETURN NEW; END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'savings completion requires read committed' USING ERRCODE = '25000';
  END IF;
  remaining := piggyvest_savings_ledger.remaining_goal_kobo(
    OLD.id, OLD.merchant_id, OLD.customer_id, NEW.target_amount, OLD.current_amount);
  IF NEW.current_amount > OLD.current_amount AND
    (OLD.status NOT IN ('active','paused') OR (NEW.current_amount - OLD.current_amount) * 100 > remaining) THEN
    RAISE EXCEPTION 'savings_contribution_exceeds_remaining_target' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status IN ('active','paused','completed') THEN
    IF piggyvest_savings_ledger.remaining_goal_kobo(
      NEW.id, NEW.merchant_id, NEW.customer_id, NEW.target_amount, NEW.current_amount) = 0 THEN
      NEW.status := 'completed';
      NEW.completed_at := coalesce(OLD.completed_at, clock_timestamp());
    ELSIF OLD.status = 'completed' THEN
      NEW.status := 'paused';
      NEW.completed_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_savings_paid_interest_capacity
  BEFORE UPDATE OF current_amount, target_amount, status ON public.customer_savings_goals
  FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_ledger.guard_goal_interest_capacity();

CREATE FUNCTION piggyvest_savings_ledger.sync_goal_interest_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE operation piggyvest_savings_ledger.operations%ROWTYPE;
BEGIN
  IF NEW.account <> 'paid_interest' THEN RETURN NEW; END IF;
  SELECT saved.id, saved.integration_id, saved.merchant_id, saved.customer_id, saved.goal_id,
    saved.command, saved.evidence_id, saved.reference_id, saved.created_at, saved.created_xid
    INTO STRICT operation FROM piggyvest_savings_ledger.operations saved WHERE saved.id = NEW.operation_id;
  IF operation.command->>'kind' NOT IN ('credit_eligible_paid_interest','reverse_credit') THEN RETURN NEW; END IF;
  PERFORM goal.id FROM public.customer_savings_goals goal
    WHERE goal.id = operation.goal_id AND goal.merchant_id = operation.merchant_id
      AND goal.customer_id = operation.customer_id FOR UPDATE;
  UPDATE public.customer_savings_goals SET status = status
    WHERE id = operation.goal_id AND merchant_id = operation.merchant_id
      AND customer_id = operation.customer_id AND goal_kind = 'legacy' AND status IN ('active','paused','completed');
  RETURN NEW;
END $$;
CREATE TRIGGER customer_savings_paid_interest_completion AFTER INSERT ON piggyvest_savings_ledger.postings
  FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_ledger.sync_goal_interest_completion();

REVOKE ALL ON FUNCTION piggyvest_savings_ledger.remaining_goal_kobo(uuid,uuid,uuid,numeric,numeric),
  piggyvest_savings_ledger.guard_goal_interest_capacity(),
  piggyvest_savings_ledger.sync_goal_interest_completion() FROM PUBLIC, anon, authenticated, service_role;

UPDATE public.customer_savings_goals goal SET status = status
WHERE goal_kind = 'legacy' AND status IN ('active','paused') AND EXISTS (
  SELECT 1 FROM piggyvest_savings_ledger.operations operation
  JOIN piggyvest_savings_ledger.postings posting ON posting.operation_id = operation.id
  WHERE operation.goal_id = goal.id AND operation.merchant_id = goal.merchant_id
    AND operation.customer_id = goal.customer_id AND posting.account = 'paid_interest'
);

COMMIT;

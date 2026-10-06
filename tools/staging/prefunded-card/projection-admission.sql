BEGIN;
CREATE FUNCTION prefunded_card.credit_route_dispatch_ready(p_operation uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  PERFORM prefunded_card.require_credit_route(operation,(SELECT system_identifier::text FROM pg_control_system()));
  RETURN true;
END $$;
CREATE FUNCTION prefunded_card.guard_credit_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE principal numeric; current_amount numeric;
BEGIN
  IF TG_OP='INSERT' OR (OLD.collection_status='not_started' AND NEW.collection_status='dispatching')
    OR (OLD.transfer_status='not_started' AND NEW.transfer_status='dispatching') THEN
    PERFORM prefunded_card.require_credit_route(NEW,(SELECT system_identifier::text FROM pg_control_system()));
    SELECT goal.current_amount INTO current_amount FROM public.customer_savings_goals goal
      WHERE goal.id=NEW.goal_id AND goal.merchant_id=NEW.merchant_id AND goal.customer_id=NEW.customer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'prefunded admission goal refused' USING ERRCODE='42501'; END IF;
    SELECT coalesce(sum(posting.amount_kobo),0) INTO principal FROM piggyvest_savings_ledger.postings posting
      JOIN piggyvest_savings_ledger.operations operation ON operation.id=posting.operation_id
      WHERE operation.goal_id=NEW.goal_id AND operation.integration_id=NEW.integration_id AND posting.account='principal';
    IF principal IS DISTINCT FROM current_amount*100 THEN
      RAISE EXCEPTION 'prefunded admission requires reconciled principal' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prefunded_credit_admission BEFORE INSERT OR UPDATE ON prefunded_card.operations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_credit_admission();
REVOKE ALL ON FUNCTION prefunded_card.guard_credit_admission(),prefunded_card.credit_route_dispatch_ready(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;

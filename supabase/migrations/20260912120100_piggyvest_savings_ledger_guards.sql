BEGIN;
CREATE FUNCTION piggyvest_savings_ledger.immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'ledger immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER operations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON piggyvest_savings_ledger.operations FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_ledger.immutable();
CREATE TRIGGER postings_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON piggyvest_savings_ledger.postings FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_ledger.immutable();
CREATE FUNCTION piggyvest_savings_ledger.guard_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'ledger immutable'; END IF;
    IF (to_jsonb(NEW) - 'enabled') IS DISTINCT FROM (to_jsonb(OLD) - 'enabled') THEN
      RAISE EXCEPTION 'ledger immutable';
    END IF;
  END IF;
  PERFORM customer.id FROM public.customers customer
    WHERE customer.id = NEW.customer_id AND customer.merchant_id = NEW.merchant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ledger ownership mismatch'; END IF;
  PERFORM goal.id FROM public.customer_savings_goals goal
    WHERE goal.id = NEW.goal_id AND goal.customer_id = NEW.customer_id AND goal.merchant_id = NEW.merchant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ledger ownership mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER binding_guard BEFORE INSERT OR UPDATE OR DELETE ON piggyvest_savings_ledger.bindings
  FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_ledger.guard_binding();
CREATE TRIGGER binding_no_truncate BEFORE TRUNCATE ON piggyvest_savings_ledger.bindings
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_ledger.immutable();

CREATE FUNCTION piggyvest_savings_ledger.check_balance() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE target uuid;
BEGIN
  IF TG_TABLE_NAME = 'operations' THEN target := NEW.id;
  ELSE target := NEW.operation_id; END IF;
  IF (SELECT count(*) < 2 OR sum(amount_kobo) <> 0
      FROM piggyvest_savings_ledger.postings WHERE operation_id = target) THEN
    RAISE EXCEPTION 'ledger unbalanced' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER operations_balanced AFTER INSERT ON piggyvest_savings_ledger.operations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_ledger.check_balance();
CREATE CONSTRAINT TRIGGER postings_balanced AFTER INSERT ON piggyvest_savings_ledger.postings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_ledger.check_balance();
CREATE FUNCTION piggyvest_savings_ledger.guard_posting() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM piggyvest_savings_ledger.operations
    WHERE id = NEW.operation_id AND created_xid = pg_current_xact_id()) THEN
    RAISE EXCEPTION 'ledger immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER posting_same_transaction BEFORE INSERT ON piggyvest_savings_ledger.postings
  FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_ledger.guard_posting();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA piggyvest_savings_ledger FROM PUBLIC, anon, authenticated, service_role;
COMMIT;

-- Local credit and Oxygen finance are mutually exclusive. A common nonblocking
-- transaction lock closes the gap between reading a ledger and inserting a
-- redemption without changing any financial evidence or reversing a debit.
CREATE FUNCTION oxygen_private.credit_admission_lock(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
    OR NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('oxygen_credit_admission:' || p_order_id::text,0)) THEN
  RAISE EXCEPTION 'oxygen_credit_check_unavailable' USING ERRCODE='40001';
 END IF;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.credit_admission_lock(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION oxygen_private.assert_no_local_credit(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM oxygen_private.credit_admission_lock(p_order_id);
 -- Historical debit evidence is deliberately conservative; no automatic
 -- reversal or expiry can prove a provider obligation has been unwound.
 IF EXISTS (SELECT 1 FROM public.orders WHERE id=p_order_id AND coalesce(wallet_amount_used,0) <> 0)
 OR EXISTS (SELECT 1 FROM public.customer_wallet_transactions WHERE source_type='order_redemption' AND type='redemption' AND source_id=p_order_id)
 OR EXISTS (SELECT 1 FROM public.customer_savings_redemptions WHERE order_id=p_order_id) THEN
  RAISE EXCEPTION 'oxygen_local_credit_in_use' USING ERRCODE='23514';
 END IF;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.assert_no_local_credit(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION oxygen_private.guard_oxygen_credit_admission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_order uuid;
BEGIN
 IF TG_TABLE_NAME='orders' THEN
  IF NEW.payment_method IS DISTINCT FROM 'oxygen' OR (TG_OP='UPDATE' AND OLD.payment_method IS NOT DISTINCT FROM 'oxygen') THEN RETURN NEW; END IF;
  v_order:=NEW.id;
 ELSIF TG_TABLE_NAME='oxygen_workflows' THEN
  v_order:=NEW.order_id;
 ELSE
  IF NEW.status NOT IN ('queued','executing') THEN RETURN NEW; END IF;
  SELECT order_id INTO v_order FROM public.oxygen_workflows WHERE id=NEW.workflow_id;
  IF v_order IS NULL THEN RAISE EXCEPTION 'oxygen_credit_check_unavailable' USING ERRCODE='40001'; END IF;
 END IF;
 PERFORM oxygen_private.assert_no_local_credit(v_order);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.guard_oxygen_credit_admission() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER oxygen_credit_method_guard BEFORE UPDATE OF payment_method ON public.orders FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_oxygen_credit_admission();
CREATE TRIGGER oxygen_credit_workflow_guard BEFORE INSERT ON public.oxygen_workflows FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_oxygen_credit_admission();
CREATE TRIGGER oxygen_credit_command_guard BEFORE INSERT OR UPDATE OF status ON oxygen_private.commands FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_oxygen_credit_admission();
CREATE TRIGGER oxygen_credit_recovery_guard BEFORE INSERT OR UPDATE OF status ON oxygen_private.payment_recovery FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_oxygen_credit_admission();
CREATE TRIGGER oxygen_credit_activation_guard BEFORE INSERT OR UPDATE OF status ON oxygen_private.general_activations FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_oxygen_credit_admission();
CREATE TRIGGER oxygen_credit_trial_guard BEFORE INSERT OR UPDATE OF status ON oxygen_private.activation_trials FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_oxygen_credit_admission();

CREATE FUNCTION oxygen_private.guard_local_credit_for_oxygen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_old uuid; v_new uuid; v_order uuid;
BEGIN
 IF TG_TABLE_NAME='customer_wallet_transactions' THEN
  IF TG_OP='UPDATE' AND (OLD.source_id,OLD.source_type,OLD.type,OLD.amount) IS NOT DISTINCT FROM (NEW.source_id,NEW.source_type,NEW.type,NEW.amount) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.source_type='order_redemption' AND OLD.type='redemption' THEN v_old:=OLD.source_id; END IF;
  IF NEW.source_type='order_redemption' AND NEW.type='redemption' THEN v_new:=NEW.source_id; END IF;
 ELSE
  IF TG_OP='UPDATE' AND (OLD.order_id,OLD.amount) IS NOT DISTINCT FROM (NEW.order_id,NEW.amount) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN v_old:=OLD.order_id; END IF;
  v_new:=NEW.order_id;
 END IF;
 -- Taking both locks in order also protects transfers of existing ledger rows.
 FOR v_order IN SELECT DISTINCT x FROM unnest(ARRAY[v_old,v_new]) AS t(x) WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM oxygen_private.credit_admission_lock(v_order);
  IF EXISTS (SELECT 1 FROM public.orders WHERE id=v_order AND payment_method='oxygen')
   OR EXISTS (SELECT 1 FROM public.oxygen_workflows WHERE order_id=v_order) THEN
   RAISE EXCEPTION 'oxygen_local_credit_in_use' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.guard_local_credit_for_oxygen() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER oxygen_local_wallet_credit_guard BEFORE INSERT OR UPDATE OF source_id,source_type,type,amount ON public.customer_wallet_transactions FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_local_credit_for_oxygen();
CREATE TRIGGER oxygen_local_savings_credit_guard BEFORE INSERT OR UPDATE OF order_id,amount ON public.customer_savings_redemptions FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_local_credit_for_oxygen();

-- A stale or separately recorded wallet amount must not appear after Oxygen
-- admission even if the ledger debit is written in a different transaction.
CREATE FUNCTION oxygen_private.guard_order_wallet_for_oxygen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.wallet_amount_used IS NOT DISTINCT FROM OLD.wallet_amount_used OR coalesce(NEW.wallet_amount_used,0)=0 THEN RETURN NEW; END IF;
 PERFORM oxygen_private.credit_admission_lock(NEW.id);
 IF NEW.payment_method='oxygen' OR EXISTS (SELECT 1 FROM public.oxygen_workflows WHERE order_id=NEW.id) THEN
  RAISE EXCEPTION 'oxygen_local_credit_in_use' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.guard_order_wallet_for_oxygen() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER oxygen_order_wallet_credit_guard BEFORE UPDATE OF wallet_amount_used ON public.orders FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_order_wallet_for_oxygen();

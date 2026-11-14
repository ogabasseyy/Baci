-- Partial boundary: recorded gateway payments may remain chargeable even after
-- a local failed/cancelled status. This is not a pre-dispatch gateway claim.
CREATE FUNCTION oxygen_private.assert_no_recorded_gateway_payment(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Never wait while holding Oxygen/order locks: payment writers may already
 -- hold this lock and be waiting for an order row. Reject stale snapshots.
 IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
 OR NOT pg_catalog.pg_try_advisory_xact_lock(
   pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text,0)
 ) THEN
  RAISE EXCEPTION 'oxygen_gateway_check_unavailable' USING ERRCODE='40001';
 END IF;
 IF EXISTS (SELECT 1 FROM public.transactions WHERE order_id=p_order_id AND transaction_type='payment') THEN
  RAISE EXCEPTION 'oxygen_gateway_payment_in_use' USING ERRCODE='23514';
 END IF;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.assert_no_recorded_gateway_payment(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION oxygen_private.guard_recorded_gateway_admission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_order uuid;
BEGIN
 IF TG_TABLE_NAME='orders' THEN
  IF NEW.payment_method IS DISTINCT FROM 'oxygen' OR OLD.payment_method IS NOT DISTINCT FROM 'oxygen' THEN RETURN NEW; END IF;
  v_order:=NEW.id;
 ELSIF TG_TABLE_NAME='oxygen_workflows' THEN
  v_order:=NEW.order_id;
 ELSE
  IF NEW.status NOT IN ('queued','executing') THEN RETURN NEW; END IF;
  -- Only the provider's status reads may investigate conflicting evidence.
  -- Mutating commands and all activation paths remain fenced.
  IF TG_TABLE_NAME='commands' THEN
   IF NEW.command->>'action' IN ('refresh_kyc','refresh_payment_setup') THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='payment_recovery' THEN
   IF NEW.action='check_status' THEN RETURN NEW; END IF;
  END IF;
  SELECT order_id INTO v_order FROM public.oxygen_workflows WHERE id=NEW.workflow_id;
  IF v_order IS NULL THEN RAISE EXCEPTION 'oxygen_gateway_check_unavailable' USING ERRCODE='40001'; END IF;
 END IF;
 PERFORM oxygen_private.assert_no_recorded_gateway_payment(v_order);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.guard_recorded_gateway_admission() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER oxygen_gateway_method_guard BEFORE UPDATE OF payment_method ON public.orders FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_recorded_gateway_admission();
CREATE TRIGGER oxygen_gateway_workflow_guard BEFORE INSERT ON public.oxygen_workflows FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_recorded_gateway_admission();
CREATE TRIGGER oxygen_gateway_command_guard BEFORE INSERT OR UPDATE ON oxygen_private.commands FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_recorded_gateway_admission();
CREATE TRIGGER oxygen_gateway_recovery_guard BEFORE INSERT OR UPDATE ON oxygen_private.payment_recovery FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_recorded_gateway_admission();
CREATE TRIGGER oxygen_gateway_activation_guard BEFORE INSERT OR UPDATE ON oxygen_private.general_activations FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_recorded_gateway_admission();
CREATE TRIGGER oxygen_gateway_trial_guard BEFORE INSERT OR UPDATE ON oxygen_private.activation_trials FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_recorded_gateway_admission();

-- Preserve the original credit admission fence, but allow the same narrowly
-- bounded provider status reads on legacy orders with conflicting credit.
CREATE OR REPLACE FUNCTION oxygen_private.guard_oxygen_credit_admission()
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
  IF TG_TABLE_NAME='commands' THEN
   IF NEW.command->>'action' IN ('refresh_kyc','refresh_payment_setup') THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='payment_recovery' THEN
   IF NEW.action='check_status' THEN RETURN NEW; END IF;
  END IF;
  SELECT order_id INTO v_order FROM public.oxygen_workflows WHERE id=NEW.workflow_id;
  IF v_order IS NULL THEN RAISE EXCEPTION 'oxygen_credit_check_unavailable' USING ERRCODE='40001'; END IF;
 END IF;
 PERFORM oxygen_private.assert_no_local_credit(v_order);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.guard_oxygen_credit_admission() FROM PUBLIC,anon,authenticated,service_role;
-- Re-check action and workflow changes as well as status changes so a read-only
-- exception cannot later be rebound to a mutating queued/executing command.
DROP TRIGGER oxygen_credit_command_guard ON oxygen_private.commands;
CREATE TRIGGER oxygen_credit_command_guard BEFORE INSERT OR UPDATE ON oxygen_private.commands FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_oxygen_credit_admission();
DROP TRIGGER oxygen_credit_recovery_guard ON oxygen_private.payment_recovery;
CREATE TRIGGER oxygen_credit_recovery_guard BEFORE INSERT OR UPDATE ON oxygen_private.payment_recovery FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_oxygen_credit_admission();

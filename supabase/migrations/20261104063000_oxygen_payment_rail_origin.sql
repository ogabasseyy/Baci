-- A gateway session can exist before its transaction row is written.  Until
-- every payment rail has a common durable pre-dispatch reservation, admit
-- Oxygen only on an order created for Oxygen from the outset.  A shopper can
-- still leave an uncommitted Oxygen application under the existing exit fence,
-- but an order that has left cannot re-enter Oxygen.
--
-- No legacy order is backfilled: the absence of a recorded gateway payment
-- does not prove that an older provider session is not still chargeable.
CREATE TABLE oxygen_private.payment_rail_origins (
 order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE
);
ALTER TABLE oxygen_private.payment_rail_origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.payment_rail_origins FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION oxygen_private.record_oxygen_order_origin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.payment_method='oxygen' THEN
  INSERT INTO oxygen_private.payment_rail_origins(order_id) VALUES(NEW.id);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.record_oxygen_order_origin() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER oxygen_record_payment_rail_origin AFTER INSERT ON public.orders
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.record_oxygen_order_origin();

CREATE FUNCTION oxygen_private.guard_oxygen_order_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.payment_method='oxygen' AND OLD.payment_method IS DISTINCT FROM 'oxygen' THEN
  RAISE EXCEPTION 'oxygen_previous_payment_unresolved' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.guard_oxygen_order_entry() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER oxygen_origin_order_entry_guard BEFORE UPDATE OF payment_method ON public.orders
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_oxygen_order_entry();

CREATE FUNCTION oxygen_private.guard_oxygen_payment_rail_origin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_order uuid;
BEGIN
 IF TG_TABLE_NAME='oxygen_workflows' THEN
  v_order:=NEW.order_id;
 ELSE
  -- Always allow a completed response to be saved. Status reads do not
  -- dispatch a new financial operation and remain available for recovery.
  IF NEW.status NOT IN ('queued','executing') THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='commands' THEN
   IF NEW.command->>'action' IN ('refresh_kyc','refresh_payment_setup') THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='payment_recovery' THEN
   IF NEW.action='check_status' THEN RETURN NEW; END IF;
  END IF;
  SELECT order_id INTO v_order FROM public.oxygen_workflows WHERE id=NEW.workflow_id;
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM oxygen_private.payment_rail_origins origin
  JOIN public.orders o ON o.id=origin.order_id
  WHERE origin.order_id=v_order AND o.payment_method='oxygen'
 ) THEN
  RAISE EXCEPTION 'oxygen_payment_origin_unverified' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.guard_oxygen_payment_rail_origin() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER oxygen_origin_workflow_guard BEFORE INSERT ON public.oxygen_workflows
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_oxygen_payment_rail_origin();
CREATE TRIGGER oxygen_origin_command_guard BEFORE INSERT OR UPDATE ON oxygen_private.commands
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_oxygen_payment_rail_origin();
CREATE TRIGGER oxygen_origin_recovery_guard BEFORE INSERT OR UPDATE ON oxygen_private.payment_recovery
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_oxygen_payment_rail_origin();
CREATE TRIGGER oxygen_origin_activation_guard BEFORE INSERT OR UPDATE ON oxygen_private.general_activations
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_oxygen_payment_rail_origin();
CREATE TRIGGER oxygen_origin_trial_guard BEFORE INSERT OR UPDATE ON oxygen_private.activation_trials
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_oxygen_payment_rail_origin();

NOTIFY pgrst,'reload schema';

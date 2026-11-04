-- A cancellation is bound to the reference present when the command is claimed.
-- Only a confirmed successful command invalidates that reference; an uncertain
-- provider outcome must preserve the cache for reconciliation.
ALTER TABLE oxygen_private.commands ADD COLUMN cancelled_booking_reference uuid;
CREATE TABLE oxygen_private.cancelled_plan_references (
 workflow_id uuid NOT NULL REFERENCES public.oxygen_workflows(id) ON DELETE CASCADE,
 booking_reference uuid NOT NULL,
 cancelled_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (workflow_id,booking_reference)
);
ALTER TABLE oxygen_private.cancelled_plan_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.cancelled_plan_references FROM PUBLIC,anon,authenticated;

CREATE FUNCTION oxygen_private.capture_cancelled_plan_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.command->>'action'='cancel_booking' AND OLD.status='queued' AND NEW.status='executing' THEN
  SELECT (state->>'bookingReference')::uuid INTO NEW.cancelled_booking_reference
  FROM oxygen_private.provider_states WHERE workflow_id=NEW.workflow_id;
  IF NEW.cancelled_booking_reference IS NULL THEN RAISE EXCEPTION 'Cancellation reference unavailable' USING ERRCODE='40001'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER oxygen_capture_cancelled_plan_reference BEFORE UPDATE OF status ON oxygen_private.commands
FOR EACH ROW EXECUTE FUNCTION oxygen_private.capture_cancelled_plan_reference();
REVOKE ALL ON FUNCTION oxygen_private.capture_cancelled_plan_reference() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION oxygen_private.invalidate_cancelled_plan()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.command->>'action'='cancel_booking' AND OLD.status='executing' AND NEW.status='succeeded' THEN
  IF NEW.cancelled_booking_reference IS NULL THEN RAISE EXCEPTION 'Cancellation reference unavailable' USING ERRCODE='40001'; END IF;
  INSERT INTO oxygen_private.cancelled_plan_references(workflow_id,booking_reference)
   VALUES(NEW.workflow_id,NEW.cancelled_booking_reference) ON CONFLICT DO NOTHING;
  DELETE FROM oxygen_private.plan_selections WHERE workflow_id=NEW.workflow_id AND booking_reference=NEW.cancelled_booking_reference;
  DELETE FROM oxygen_private.saved_plans WHERE workflow_id=NEW.workflow_id AND booking_reference=NEW.cancelled_booking_reference;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER oxygen_invalidate_cancelled_plan AFTER UPDATE OF status ON oxygen_private.commands
FOR EACH ROW EXECUTE FUNCTION oxygen_private.invalidate_cancelled_plan();
REVOKE ALL ON FUNCTION oxygen_private.invalidate_cancelled_plan() FROM PUBLIC,anon,authenticated;

-- Enforce exclusion at the cache boundary, including stale snapshot replays.
-- Returning NULL avoids turning a derived-cache miss into a provider-state error.
CREATE FUNCTION oxygen_private.reject_cancelled_saved_plan()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM oxygen_private.cancelled_plan_references
  WHERE workflow_id=NEW.workflow_id AND booking_reference=NEW.booking_reference) THEN RETURN NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER oxygen_reject_cancelled_saved_plan BEFORE INSERT OR UPDATE ON oxygen_private.saved_plans
FOR EACH ROW EXECUTE FUNCTION oxygen_private.reject_cancelled_saved_plan();
REVOKE ALL ON FUNCTION oxygen_private.reject_cancelled_saved_plan() FROM PUBLIC,anon,authenticated;

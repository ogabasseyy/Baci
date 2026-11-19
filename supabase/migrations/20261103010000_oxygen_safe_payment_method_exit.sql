-- Keep the financial fence, but permit an exit before a booking is possible.
-- The workflow lock serializes this decision with command enqueue and claim.
CREATE OR REPLACE FUNCTION oxygen_private.guard_order_payment_method()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.oxygen_workflows%ROWTYPE;
BEGIN
  IF OLD.payment_method = 'oxygen' AND NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
    SELECT * INTO w FROM public.oxygen_workflows WHERE order_id = OLD.id FOR UPDATE;
    IF FOUND AND (
      w.stage NOT IN ('application_required','eligibility_required','kyc_required','plan_required')
      OR EXISTS (SELECT 1 FROM oxygen_private.commands c WHERE c.workflow_id=w.id AND (
        c.status IN ('queued','executing','indeterminate') OR
        COALESCE(c.command->>'action','') NOT IN ('start_application','validate_customer','resend_customer_otp','refresh_eligibility','refresh_kyc','validate_nin','selfie_link')
      ))
      OR EXISTS (SELECT 1 FROM oxygen_private.provider_states s WHERE s.workflow_id=w.id AND (s.state ? 'bookingReference' OR s.state ? 'booking'))
      OR EXISTS (SELECT 1 FROM oxygen_private.provider_reference_history h WHERE h.workflow_id=w.id AND h.booking_reference IS NOT NULL)
      OR EXISTS (SELECT 1 FROM oxygen_private.saved_plans p WHERE p.workflow_id=w.id)
      OR EXISTS (SELECT 1 FROM oxygen_private.plan_selections p WHERE p.workflow_id=w.id)
      OR EXISTS (SELECT 1 FROM oxygen_private.payment_recovery p WHERE p.workflow_id=w.id)
      OR EXISTS (SELECT 1 FROM oxygen_private.activation_trials a WHERE a.workflow_id=w.id)
      OR EXISTS (SELECT 1 FROM oxygen_private.general_activations a WHERE a.workflow_id=w.id)
    ) THEN
      RAISE EXCEPTION 'oxygen_payment_in_progress' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

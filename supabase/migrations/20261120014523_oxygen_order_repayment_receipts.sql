-- Project transaction acknowledgements from the authenticated callback inbox.
-- The inbox already deduplicates each typed reference per partner and environment.
CREATE TABLE oxygen_private.repayment_booking_bindings (
  workflow_id uuid NOT NULL REFERENCES public.oxygen_workflows(id) ON DELETE CASCADE,
  booking_reference text NOT NULL CHECK (booking_reference = lower(booking_reference)),
  partner_reference text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('staging', 'production')),
  PRIMARY KEY (workflow_id, booking_reference)
);
CREATE INDEX oxygen_repayment_binding_booking_idx
  ON oxygen_private.repayment_booking_bindings (booking_reference, workflow_id);
ALTER TABLE oxygen_private.repayment_booking_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.repayment_booking_bindings
  FROM PUBLIC, anon, authenticated, service_role, oxygen_workflow_worker;

-- Capture the binding in the same database transaction that claims the
-- booking. Looking it up at completion could pick a replacement partner.
CREATE TABLE oxygen_private.repayment_booking_claims (
  command_id uuid PRIMARY KEY REFERENCES oxygen_private.commands(id) ON DELETE CASCADE,
  partner_reference text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('staging', 'production'))
);
ALTER TABLE oxygen_private.repayment_booking_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.repayment_booking_claims
  FROM PUBLIC, anon, authenticated, service_role, oxygen_workflow_worker;
CREATE FUNCTION oxygen_private.capture_repayment_booking_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO oxygen_private.repayment_booking_claims (command_id, partner_reference, environment)
  SELECT NEW.id, b.partner_reference, b.environment
  FROM public.oxygen_workflows AS w
  JOIN oxygen_private.runtime_bindings AS b
    ON b.merchant_id = w.merchant_id AND b.environment = w.environment
  WHERE w.id = NEW.workflow_id AND b.enabled AND b.worker_user_id = auth.uid()
  FOR SHARE OF b
  ON CONFLICT (command_id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.capture_repayment_booking_claim()
  FROM PUBLIC, anon, authenticated, service_role, oxygen_workflow_worker;
CREATE FUNCTION oxygen_private.capture_repayment_booking_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Runtime writes the reference history for the exact command that produced
  -- the booking, in the same transaction as the provider state. Move the
  -- claim into the booking binding. Incomplete claims follow command retention.
  -- The reference history stores a UUID, whose text form is lowercase.
  WITH claimed AS (
    DELETE FROM oxygen_private.repayment_booking_claims
    WHERE command_id = NEW.command_id
    RETURNING partner_reference, environment
  )
  INSERT INTO oxygen_private.repayment_booking_bindings (
    workflow_id, booking_reference, partner_reference, environment
  )
  SELECT NEW.workflow_id, NEW.booking_reference::text, claim.partner_reference, claim.environment
  FROM claimed AS claim
  ON CONFLICT (workflow_id, booking_reference) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.capture_repayment_booking_binding()
  FROM PUBLIC, anon, authenticated, service_role, oxygen_workflow_worker;
CREATE TRIGGER oxygen_capture_repayment_booking_binding
  AFTER INSERT ON oxygen_private.provider_reference_history
  FOR EACH ROW WHEN (NEW.booking_reference IS NOT NULL)
  EXECUTE FUNCTION oxygen_private.capture_repayment_booking_binding();

-- Drain or reconcile existing book commands before applying this migration.
-- The check and trigger creation share a lock, including during psql replay.
DO $$ BEGIN
  LOCK TABLE oxygen_private.commands IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  IF EXISTS (
    SELECT 1 FROM oxygen_private.commands
    WHERE status = 'executing' AND command->>'action' = 'book'
  ) THEN
    RAISE EXCEPTION 'Drain executing Oxygen booking commands before applying repayment history';
  END IF;
  CREATE TRIGGER oxygen_capture_repayment_booking_claim
    AFTER UPDATE OF status ON oxygen_private.commands
    FOR EACH ROW
    WHEN (OLD.status = 'queued' AND NEW.status = 'executing' AND NEW.command->>'action' = 'book')
    EXECUTE FUNCTION oxygen_private.capture_repayment_booking_claim();
END $$;

-- Legacy bookings without a recorded partner can still show their saved
-- schedule. The current merchant binding cannot prove who booked those loans.
-- These are provider reports only. They do not confirm any money movement.
CREATE OR REPLACE FUNCTION public.oxygen_order_repayment_receipts(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(jsonb_agg(
    jsonb_build_object('id', i.id, 'recordedAt', i.received_at)
    ORDER BY i.received_at DESC, i.id
  ), '[]'::jsonb)
  FROM (
    SELECT i.id, i.received_at
    FROM public.oxygen_workflows AS w
    JOIN public.orders AS o
      ON o.id = w.order_id AND o.merchant_id = w.merchant_id
      AND o.customer_id = w.customer_id
    JOIN public.customers AS c
      ON c.id = w.customer_id AND c.merchant_id = w.merchant_id
    JOIN oxygen_private.provider_states AS s ON s.workflow_id = w.id
    JOIN oxygen_private.repayment_booking_bindings AS b
      ON b.workflow_id = w.id AND b.environment = w.environment
      AND b.booking_reference = lower(s.state->>'bookingReference')
    -- A callback tagged with a different environment has no authority for
    -- this booking, even after a runtime binding switch. Do not reattribute it.
    JOIN oxygen_private.callback_inbox AS i
      ON i.partner_reference = b.partner_reference AND i.environment = b.environment
      AND lower(i.event->>'bookedLoanReference') = b.booking_reference
    WHERE w.order_id = p_order_id
      AND c.user_id = (SELECT auth.uid())
      AND w.stage = 'activated'
      AND s.state#>>'{booking,status}' = 'ACTIVATED'
      AND lower(s.state#>>'{booking,loan_reference}') = b.booking_reference
      -- The provider-state uniqueness constraint compares raw JSON text.
      -- Reject case-equivalent references across workflows, including legacy
      -- workflows without a pinned binding.
      AND NOT EXISTS (
        SELECT 1 FROM oxygen_private.provider_states AS other
        WHERE other.state->>'bookingReference' IS NOT NULL
          AND lower(other.state->>'bookingReference') = b.booking_reference
          AND other.workflow_id <> w.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM oxygen_private.repayment_booking_bindings AS other
        WHERE other.booking_reference = b.booking_reference
          AND other.workflow_id <> w.id
      )
      AND i.event->>'kind' = 'transaction'
      AND nullif(i.event->>'transactionReference', '') IS NOT NULL
      AND i.deduplication_key = 'transaction-loan_repayment:' || (i.event->>'transactionReference')
      -- The webhook's stringMoney schema accepts bounded decimal text with
      -- up to two fractional digits and preserves that text in the inbox.
      AND char_length(i.event->>'providerAmountSent') <= 32
      AND i.event->>'providerAmountSent' ~ '^[0-9]{1,32}([.][0-9]{1,2})?$'
      AND i.event->>'providerAmountSent' ~ '[1-9]'
    ORDER BY i.received_at DESC, i.id
    LIMIT 50
  ) AS i
$$;

REVOKE ALL ON FUNCTION public.oxygen_order_repayment_receipts(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.oxygen_order_repayment_receipts(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';

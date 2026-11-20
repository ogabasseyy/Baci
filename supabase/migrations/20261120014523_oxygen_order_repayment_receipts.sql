-- Project transaction acknowledgements from the authenticated callback inbox.
-- The inbox already deduplicates each typed reference per partner and environment.
CREATE TABLE oxygen_private.repayment_booking_bindings (
  workflow_id uuid NOT NULL REFERENCES public.oxygen_workflows(id) ON DELETE CASCADE,
  booking_reference text NOT NULL,
  partner_reference text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('staging', 'production')),
  PRIMARY KEY (workflow_id, booking_reference)
);
ALTER TABLE oxygen_private.repayment_booking_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.repayment_booking_bindings
  FROM PUBLIC, anon, authenticated, service_role, oxygen_workflow_worker;

CREATE FUNCTION oxygen_private.capture_repayment_booking_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  booking_ref text := nullif(NEW.state->>'bookingReference', '');
BEGIN
  IF booking_ref IS NULL
    OR booking_ref IS DISTINCT FROM NEW.state#>>'{booking,loan_reference}' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND booking_ref = OLD.state->>'bookingReference'
    AND booking_ref = OLD.state#>>'{booking,loan_reference}' THEN
    RETURN NEW;
  END IF;

  INSERT INTO oxygen_private.repayment_booking_bindings (
    workflow_id, booking_reference, partner_reference, environment
  )
  SELECT w.id, booking_ref, b.partner_reference, w.environment
  FROM public.oxygen_workflows AS w
  JOIN oxygen_private.runtime_bindings AS b
    ON b.merchant_id = w.merchant_id AND b.environment = w.environment
  WHERE w.id = NEW.workflow_id
  ON CONFLICT (workflow_id, booking_reference) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.capture_repayment_booking_binding()
  FROM PUBLIC, anon, authenticated, service_role, oxygen_workflow_worker;
CREATE TRIGGER oxygen_capture_repayment_booking_binding
  AFTER INSERT OR UPDATE OF state ON oxygen_private.provider_states
  FOR EACH ROW EXECUTE FUNCTION oxygen_private.capture_repayment_booking_binding();

-- Install the trigger first so a booking cannot arrive between the backfill
-- snapshot and capture becoming active. Leave old bookings without matching
-- binding evidence unassociated.
INSERT INTO oxygen_private.repayment_booking_bindings (
  workflow_id, booking_reference, partner_reference, environment
)
SELECT w.id, s.state->>'bookingReference', b.partner_reference, w.environment
FROM oxygen_private.provider_states AS s
JOIN public.oxygen_workflows AS w ON w.id = s.workflow_id
JOIN oxygen_private.runtime_bindings AS b
  ON b.merchant_id = w.merchant_id AND b.environment = w.environment
WHERE nullif(s.state->>'bookingReference', '') = s.state#>>'{booking,loan_reference}'
ON CONFLICT (workflow_id, booking_reference) DO NOTHING;

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
  FROM public.oxygen_workflows AS w
  JOIN public.orders AS o
    ON o.id = w.order_id AND o.merchant_id = w.merchant_id
    AND o.customer_id = w.customer_id
  JOIN public.customers AS c
    ON c.id = w.customer_id AND c.merchant_id = w.merchant_id
  JOIN oxygen_private.provider_states AS s ON s.workflow_id = w.id
  JOIN oxygen_private.repayment_booking_bindings AS b
    ON b.workflow_id = w.id AND b.environment = w.environment
    AND b.booking_reference = s.state->>'bookingReference'
  JOIN oxygen_private.callback_inbox AS i
    ON i.partner_reference = b.partner_reference AND i.environment = b.environment
    AND i.event->>'bookedLoanReference' = b.booking_reference
  WHERE w.order_id = p_order_id
    AND c.user_id = (SELECT auth.uid())
    AND w.stage = 'activated'
    AND s.state#>>'{booking,status}' = 'ACTIVATED'
    AND s.state#>>'{booking,loan_reference}' = b.booking_reference
    AND i.event->>'kind' = 'transaction'
    AND nullif(i.event->>'transactionReference', '') IS NOT NULL
    AND i.deduplication_key = 'transaction-loan_repayment:' || (i.event->>'transactionReference')
    AND i.event->>'providerAmountSent' ~ '^[0-9]{1,32}([.][0-9]{1,2})?$'
    AND i.event->>'providerAmountSent' ~ '[1-9]'
$$;

REVOKE ALL ON FUNCTION public.oxygen_order_repayment_receipts(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.oxygen_order_repayment_receipts(uuid) TO authenticated;

-- REGRESSION: claim_repair_pickup_booking refuses terminal repairs and reports
-- terminal=true so callers map to terminal_status instead of booking_in_progress.

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  '94a63d82-0000-4000-8000-000000000001',
  'claim-terminal@example.com',
  'Claim Terminal Merchant',
  'claim-terminal-merchant',
  true
);

INSERT INTO public.repairs (
  id,
  merchant_id,
  customer_name,
  customer_email,
  customer_phone,
  device_type,
  device_model,
  issue_description,
  service_type,
  pickup_address,
  status,
  pickup_payment_status,
  pickup_payment_reference,
  pickup_fee,
  pickup_currency
)
VALUES (
  '94a63d82-0000-4000-8000-000000000010',
  '94a63d82-0000-4000-8000-000000000001',
  'Ada Lovelace',
  'ada@example.com',
  '+2348012345678',
  'Smartphone',
  'iPhone 15',
  'Screen unresponsive',
  'pickup',
  '12 Station Road, Osogbo',
  'cancelled',
  'paid',
  'RPU-TERMINALCLAIM01',
  8250,
  'NGN'
);

DO $test$
DECLARE
  v_claimed boolean;
  v_shipment_id uuid;
  v_terminal boolean;
BEGIN
  SELECT claim.claimed, claim.shipment_id, claim.terminal
  INTO v_claimed, v_shipment_id, v_terminal
  FROM public.claim_repair_pickup_booking(
    '94a63d82-0000-4000-8000-000000000010',
    '94a63d82-0000-4000-8000-000000000001',
    '94a63d82-0000-4000-8000-000000000099',
    900
  ) AS claim;

  IF v_claimed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'terminal repair was claimed for pickup booking';
  END IF;
  IF v_shipment_id IS NOT NULL THEN
    RAISE EXCEPTION 'terminal claim unexpectedly reported a shipment';
  END IF;
  IF v_terminal IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'terminal repair claim did not report terminal=true';
  END IF;
END;
$test$;

ROLLBACK;

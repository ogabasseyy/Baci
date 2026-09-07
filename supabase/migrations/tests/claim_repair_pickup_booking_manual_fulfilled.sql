-- REGRESSION: claim_repair_pickup_booking refuses manual_fulfilled repairs and
-- reports terminal=true so a concurrent automatic booker cannot claim after the
-- merchant records offline fulfillment mid-quote.

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  '94a63d82-0000-4000-8000-000000000002',
  'claim-manual@example.com',
  'Claim Manual Merchant',
  'claim-manual-merchant',
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
  '94a63d82-0000-4000-8000-000000000011',
  '94a63d82-0000-4000-8000-000000000002',
  'Ada Lovelace',
  'ada@example.com',
  '+2348012345678',
  'Smartphone',
  'iPhone 15',
  'Screen unresponsive',
  'pickup',
  '12 Station Road, Osogbo',
  'pending',
  'manual_fulfilled',
  'RPU-MANUALCLAIM01',
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
    '94a63d82-0000-4000-8000-000000000011',
    '94a63d82-0000-4000-8000-000000000002',
    '94a63d82-0000-4000-8000-000000000098',
    900
  ) AS claim;

  IF v_claimed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'manual_fulfilled repair was claimed for pickup booking';
  END IF;
  IF v_shipment_id IS NOT NULL THEN
    RAISE EXCEPTION 'manual_fulfilled claim unexpectedly reported a shipment';
  END IF;
  IF v_terminal IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'manual_fulfilled claim did not report terminal=true';
  END IF;
END;
$test$;

ROLLBACK;

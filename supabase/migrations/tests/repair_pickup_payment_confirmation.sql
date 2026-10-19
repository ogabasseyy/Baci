-- REGRESSION TEST: only service_role can atomically confirm a paid repair
-- pickup, and webhook replays create neither a second transaction nor a
-- second payment transition.

BEGIN;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  '73a63d82-0000-4000-8000-000000000001',
  'repair-payment-merchant@example.com',
  'Repair Payment Merchant',
  'repair-payment-merchant',
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
  status
)
VALUES (
  '73a63d82-0000-4000-8000-000000000002',
  '73a63d82-0000-4000-8000-000000000001',
  'Ada Lovelace',
  'ada@example.com',
  '+2348012345678',
  'Smartphone',
  'iPhone 15',
  'The screen no longer responds to touch.',
  'pickup',
  '12 Station Road, Osogbo, Osun, Nigeria',
  'pending'
);

DO $test$
DECLARE
  v_confirmed boolean;
BEGIN
  SELECT confirmation.confirmed
  INTO v_confirmed
  FROM public.confirm_repair_pickup_payment(
    '73a63d82-0000-4000-8000-000000000002',
    '73a63d82-0000-4000-8000-000000000001',
    'RPU-SQLREGRESSION123',
    8250,
    'NGN',
    '{"status":"success"}'::jsonb
  ) AS confirmation;

  IF v_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'first pickup payment was not confirmed';
  END IF;

  SELECT confirmation.confirmed
  INTO v_confirmed
  FROM public.confirm_repair_pickup_payment(
    '73a63d82-0000-4000-8000-000000000002',
    '73a63d82-0000-4000-8000-000000000001',
    'RPU-SQLREGRESSION123',
    8250,
    'NGN',
    '{"status":"success"}'::jsonb
  ) AS confirmation;

  IF v_confirmed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'duplicate pickup payment was not idempotent';
  END IF;

  BEGIN
    PERFORM public.confirm_repair_pickup_payment(
      '73a63d82-0000-4000-8000-000000000002',
      '73a63d82-0000-4000-8000-000000000001',
      'RPU-SQLREGRESSION999',
      8250,
      'NGN',
      '{"status":"success"}'::jsonb
    );
    RAISE EXCEPTION 'conflicting pickup payment was accepted';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  IF (
    SELECT repair.pickup_payment_reference
    FROM public.repairs AS repair
    WHERE repair.id = '73a63d82-0000-4000-8000-000000000002'
  ) <> 'RPU-SQLREGRESSION123' THEN
    RAISE EXCEPTION 'conflicting pickup payment changed the reference';
  END IF;

  IF (
    SELECT count(*)
    FROM public.transactions AS transaction
    WHERE transaction.gateway_reference = 'RPU-SQLREGRESSION123'
  ) <> 1 THEN
    RAISE EXCEPTION 'pickup payment created duplicate transactions';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.repairs AS repair
    WHERE repair.id = '73a63d82-0000-4000-8000-000000000002'
      AND repair.pickup_payment_status = 'paid'
      AND repair.pickup_payment_reference = 'RPU-SQLREGRESSION123'
      AND repair.pickup_fee = 8250
      AND repair.pickup_paid_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'repair pickup payment snapshot was not persisted';
  END IF;
END;
$test$;

-- Late Paystack settlement after staff cancelled the repair must still capture
-- the payment for refund/review instead of raising forever.
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
  status
)
VALUES (
  '73a63d82-0000-4000-8000-000000000003',
  '73a63d82-0000-4000-8000-000000000001',
  'Grace Hopper',
  'grace@example.com',
  '+2348098765432',
  'Laptop',
  'MacBook Pro',
  'Battery swells after charging.',
  'pickup',
  '8 Broad Street, Lagos, Lagos, Nigeria',
  'cancelled'
);

DO $test$
DECLARE
  v_confirmed boolean;
BEGIN
  SELECT confirmation.confirmed
  INTO v_confirmed
  FROM public.confirm_repair_pickup_payment(
    '73a63d82-0000-4000-8000-000000000003',
    '73a63d82-0000-4000-8000-000000000001',
    'RPU-SQLTERMINAL00001',
    9100,
    'NGN',
    '{"status":"success"}'::jsonb
  ) AS confirmation;

  IF v_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'terminal repair pickup payment was not captured';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.repairs AS repair
    WHERE repair.id = '73a63d82-0000-4000-8000-000000000003'
      AND repair.pickup_payment_status = 'review'
      AND repair.pickup_payment_reference = 'RPU-SQLTERMINAL00001'
      AND repair.pickup_fee = 9100
      AND repair.status = 'cancelled'
  ) THEN
    RAISE EXCEPTION 'terminal repair pickup payment was not marked for review';
  END IF;

  IF (
    SELECT count(*)
    FROM public.transactions AS transaction
    WHERE transaction.gateway_reference = 'RPU-SQLTERMINAL00001'
  ) <> 1 THEN
    RAISE EXCEPTION 'terminal repair pickup payment transaction missing';
  END IF;
END;
$test$;

RESET ROLE;

DO $test$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.confirm_repair_pickup_payment(uuid,uuid,text,numeric,text,jsonb)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.confirm_repair_pickup_payment(uuid,uuid,text,numeric,text,jsonb)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.confirm_repair_pickup_payment(uuid,uuid,text,numeric,text,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'repair pickup payment function grants are unsafe';
  END IF;
END;
$test$;

ROLLBACK;

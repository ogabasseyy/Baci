-- REGRESSION: paid-fulfillment JWT still projects an unpublished or
-- pickup-disabled repair center; quote JWT does not.

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES
  (
    '84a63d82-0000-4000-8000-000000000002',
    'unpublished-fulfillment-receiver@example.com',
    'Unpublished Fulfillment Receiver',
    'unpublished-fulfillment-receiver',
    false
  ),
  (
    '84a63d82-0000-4000-8000-000000000003',
    'disabled-fulfillment-receiver@example.com',
    'Disabled Fulfillment Receiver',
    'disabled-fulfillment-receiver',
    true
  );

INSERT INTO public.merchant_feature_settings (merchant_id, repair_settings)
VALUES
  (
    '84a63d82-0000-4000-8000-000000000002',
    jsonb_build_object(
      'pickup_address', '1 Private Road, Lagos',
      'contact_name', 'Hidden Repair Center',
      'contact_phone', '08087654321',
      'city', 'Lagos',
      'state', 'Lagos',
      'country', 'Nigeria'
    )
  ),
  (
    '84a63d82-0000-4000-8000-000000000003',
    jsonb_build_object(
      'pickup_enabled', false,
      'pickup_address', '9 Disabled Close, Abuja',
      'contact_name', 'Disabled Repair Center',
      'contact_phone', '08011112222',
      'city', 'Abuja',
      'state', 'FCT',
      'country', 'Nigeria'
    )
  )
ON CONFLICT (merchant_id) DO UPDATE
SET repair_settings = EXCLUDED.repair_settings;

SET LOCAL ROLE repair_pickup_receiver;

DO $test$
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'repair_pickup_receiver',
      'repair_pickup_receiver_context', 'server-quote',
      'repair_pickup_receiver_merchant_id',
      '84a63d82-0000-4000-8000-000000000002'
    )::text,
    true
  );

  IF public.get_repair_pickup_receiver(
    '84a63d82-0000-4000-8000-000000000002'
  ) IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'quote JWT received an unpublished repair-center projection';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'repair_pickup_receiver',
      'repair_pickup_receiver_context', 'server-fulfillment',
      'repair_pickup_receiver_merchant_id',
      '84a63d82-0000-4000-8000-000000000002'
    )::text,
    true
  );

  IF public.get_repair_pickup_receiver(
    '84a63d82-0000-4000-8000-000000000002'
  ) ->> 'address' IS DISTINCT FROM '1 Private Road, Lagos' THEN
    RAISE EXCEPTION 'fulfillment JWT did not receive unpublished repair-center';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'repair_pickup_receiver',
      'repair_pickup_receiver_context', 'server-quote',
      'repair_pickup_receiver_merchant_id',
      '84a63d82-0000-4000-8000-000000000003'
    )::text,
    true
  );

  IF public.get_repair_pickup_receiver(
    '84a63d82-0000-4000-8000-000000000003'
  ) IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'quote JWT received a pickup-disabled repair-center';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'repair_pickup_receiver',
      'repair_pickup_receiver_context', 'server-fulfillment',
      'repair_pickup_receiver_merchant_id',
      '84a63d82-0000-4000-8000-000000000003'
    )::text,
    true
  );

  IF public.get_repair_pickup_receiver(
    '84a63d82-0000-4000-8000-000000000003'
  ) ->> 'phone' IS DISTINCT FROM '08011112222' THEN
    RAISE EXCEPTION 'fulfillment JWT did not receive pickup-disabled repair-center';
  END IF;
END;
$test$;

RESET ROLE;

ROLLBACK;

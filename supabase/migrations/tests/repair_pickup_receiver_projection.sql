-- REGRESSION TEST: the repair-pickup receiver projection exposes published,
-- phone-complete destinations only to the merchant-bound server capability.

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES
  (
    '74a63d82-0000-4000-8000-000000000001',
    'published-repair-receiver@example.com',
    'Published Repair Receiver',
    'published-repair-receiver',
    true
  ),
  (
    '74a63d82-0000-4000-8000-000000000002',
    'private-repair-receiver@example.com',
    'Private Repair Receiver',
    'private-repair-receiver',
    false
  ),
  (
    '74a63d82-0000-4000-8000-000000000003',
    'disabled-repair-receiver@example.com',
    'Disabled Repair Receiver',
    'disabled-repair-receiver',
    true
  ),
  (
    '74a63d82-0000-4000-8000-000000000005',
    'phoneless-repair-receiver@example.com',
    'Phoneless Repair Receiver',
    'phoneless-repair-receiver',
    true
  );

INSERT INTO public.merchant_feature_settings (merchant_id, repair_settings)
VALUES
  (
    '74a63d82-0000-4000-8000-000000000001',
    jsonb_build_object(
      'pickup_address', '3 Olayeni Street, Computer Village',
      'contact_name', 'Ogabassey Repair Center',
      'contact_phone', '+2349070007000',
      'contact_email', 'repairs@ogabassey.com',
      'city', 'Ikeja',
      'state', 'Lagos',
      'country', 'Nigeria'
    )
  ),
  (
    '74a63d82-0000-4000-8000-000000000002',
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
    '74a63d82-0000-4000-8000-000000000003',
    jsonb_build_object(
      'pickup_enabled', false,
      'pickup_address', '9 Disabled Close, Abuja',
      'contact_name', 'Disabled Repair Center',
      'contact_phone', '08011112222',
      'city', 'Abuja',
      'state', 'FCT',
      'country', 'Nigeria'
    )
  ),
  (
    '74a63d82-0000-4000-8000-000000000005',
    jsonb_build_object(
      'pickup_address', '5 Silent Avenue, Lagos',
      'contact_name', 'Phoneless Repair Center',
      'contact_phone', '',
      'city', 'Lagos',
      'state', 'Lagos',
      'country', 'Nigeria'
    )
  )
ON CONFLICT (merchant_id) DO UPDATE
SET repair_settings = EXCLUDED.repair_settings;

SET LOCAL ROLE repair_pickup_receiver;

DO $test$
BEGIN
  IF public.get_repair_pickup_receiver(
    '74a63d82-0000-4000-8000-000000000001'
  ) IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'unscoped receiver role received repair-center details';
  END IF;
END;
$test$;

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'repair_pickup_receiver',
    'repair_pickup_receiver_context', 'server-quote',
    'repair_pickup_receiver_merchant_id',
    '74a63d82-0000-4000-8000-000000000001'
  )::text,
  true
);

DO $test$
BEGIN
  IF public.get_repair_pickup_receiver(
    '74a63d82-0000-4000-8000-000000000001'
  ) ->> 'address' IS DISTINCT FROM '3 Olayeni Street, Computer Village' THEN
    RAISE EXCEPTION 'server capability did not receive its repair center';
  END IF;

  IF public.get_repair_pickup_receiver(
    '74a63d82-0000-4000-8000-000000000001'
  ) ->> 'phone' IS DISTINCT FROM '+2349070007000' THEN
    RAISE EXCEPTION 'server capability did not receive repair-center phone';
  END IF;

  IF public.get_repair_pickup_receiver(
    '74a63d82-0000-4000-8000-000000000002'
  ) IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'capability disclosed a different merchant receiver';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'repair_pickup_receiver',
      'repair_pickup_receiver_context', 'server-quote',
      'repair_pickup_receiver_merchant_id',
      '74a63d82-0000-4000-8000-000000000002'
    )::text,
    true
  );

  IF public.get_repair_pickup_receiver(
    '74a63d82-0000-4000-8000-000000000002'
  ) IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'anon received an unpublished repair-center projection';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'repair_pickup_receiver',
      'repair_pickup_receiver_context', 'server-quote',
      'repair_pickup_receiver_merchant_id',
      '74a63d82-0000-4000-8000-000000000003'
    )::text,
    true
  );

  IF public.get_repair_pickup_receiver(
    '74a63d82-0000-4000-8000-000000000003'
  ) IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'anon received a pickup-disabled repair-center projection';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'repair_pickup_receiver',
      'repair_pickup_receiver_context', 'server-quote',
      'repair_pickup_receiver_merchant_id',
      '74a63d82-0000-4000-8000-000000000005'
    )::text,
    true
  );

  IF public.get_repair_pickup_receiver(
    '74a63d82-0000-4000-8000-000000000005'
  ) IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'anon received a phoneless repair-center projection';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'repair_pickup_receiver',
      'repair_pickup_receiver_context', 'server-quote',
      'repair_pickup_receiver_merchant_id',
      '74a63d82-0000-4000-8000-000000000004'
    )::text,
    true
  );

  IF public.get_repair_pickup_receiver(
    '74a63d82-0000-4000-8000-000000000004'
  ) IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'anon received data for a missing merchant';
  END IF;
END;
$test$;

RESET ROLE;

DO $test$
DECLARE
  v_unexpected_grantees text[];
BEGIN
  IF has_function_privilege(
    'anon',
    'public.get_repair_pickup_receiver(uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.get_repair_pickup_receiver(uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.get_repair_pickup_receiver(uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'repair_pickup_receiver',
    'public.get_repair_pickup_receiver(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'receiver projection grant is not limited to scoped role';
  END IF;

  SELECT array_agg(role_name ORDER BY role_name)
  INTO v_unexpected_grantees
  FROM (
    SELECT COALESCE(role.rolname, 'PUBLIC') AS role_name
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL aclexplode(procedure.proacl) AS privilege
    LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = privilege.grantee
    WHERE procedure.oid =
      'public.get_repair_pickup_receiver(uuid)'::regprocedure
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.grantee <> procedure.proowner
      AND COALESCE(role.rolname, 'PUBLIC') <> 'repair_pickup_receiver'
  ) AS unexpected;

  IF v_unexpected_grantees IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected receiver projection grantees: %',
      v_unexpected_grantees;
  END IF;
END;
$test$;

ROLLBACK;

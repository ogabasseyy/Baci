-- REGRESSION: unpaid pickup reclaim must go through the merchant-bound
-- repair_pickup_receiver capability (SECURITY DEFINER). Ordinary JWTs must
-- not learn repair UUIDs/tickets from email + merchant alone. When p_repair_id
-- is provided, reclaim that specific unpaid ticket (not a newer sibling).

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  '84a63d82-0000-4000-8000-000000000001',
  'resumable-pickup@example.com',
  'Resumable Pickup Merchant',
  'resumable-pickup-merchant',
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
  created_at
)
VALUES
(
  '84a63d82-0000-4000-8000-000000000010',
  '84a63d82-0000-4000-8000-000000000001',
  'Ada Lovelace',
  'ada@example.com',
  '+2348012345678',
  'Smartphone',
  'iPhone 15',
  'Screen unresponsive',
  'pickup',
  '12 Station Road, Osogbo',
  'pending',
  now() - interval '30 minutes'
),
(
  '84a63d82-0000-4000-8000-000000000011',
  '84a63d82-0000-4000-8000-000000000001',
  'Ada Lovelace',
  'ada@example.com',
  '+2348012345678',
  'Smartphone',
  'iPhone 15',
  'Battery swollen',
  'pickup',
  '12 Station Road, Osogbo',
  'pending',
  now() - interval '10 minutes'
);

-- Persist expected ticket in session GUC before switching roles.
-- repair_pickup_receiver cannot SELECT public.repairs (by design).
SELECT pg_catalog.set_config(
  'test.find_resumable_expected_ticket',
  repairs.ticket_number::text,
  true
)
FROM public.repairs AS repairs
WHERE repairs.id = '84a63d82-0000-4000-8000-000000000010';

SELECT pg_catalog.set_config(
  'test.find_resumable_newer_ticket',
  repairs.ticket_number::text,
  true
)
FROM public.repairs AS repairs
WHERE repairs.id = '84a63d82-0000-4000-8000-000000000011';

SET LOCAL ROLE repair_pickup_receiver;

DO $$
DECLARE
  found_id uuid;
  found_ticket integer;
  expected_ticket integer :=
    nullif(
      current_setting('test.find_resumable_expected_ticket', true),
      ''
    )::integer;
  newer_ticket integer :=
    nullif(
      current_setting('test.find_resumable_newer_ticket', true),
      ''
    )::integer;
BEGIN
  IF expected_ticket IS NULL OR newer_ticket IS NULL THEN
    RAISE EXCEPTION 'expected tickets were not captured before role switch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.find_resumable_repair_pickup(
      '84a63d82-0000-4000-8000-000000000001',
      'Ada@Example.com'
    )
  ) THEN
    RAISE EXCEPTION 'unscoped receiver role reclaimed a pickup ticket';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'repair_pickup_receiver',
      'repair_pickup_receiver_context', 'server-quote',
      'repair_pickup_receiver_merchant_id',
      '84a63d82-0000-4000-8000-000000000001'
    )::text,
    true
  );

  SELECT reclaim.id, reclaim.ticket_number
  INTO found_id, found_ticket
  FROM public.find_resumable_repair_pickup(
    '84a63d82-0000-4000-8000-000000000001',
    'Ada@Example.com'
  ) AS reclaim;

  IF found_id IS DISTINCT FROM '84a63d82-0000-4000-8000-000000000011'::uuid
    OR found_ticket IS DISTINCT FROM newer_ticket
  THEN
    RAISE EXCEPTION
      'email-only reclaim must return newest unpaid pickup; got id=% ticket=%',
      found_id,
      found_ticket;
  END IF;

  SELECT reclaim.id, reclaim.ticket_number
  INTO found_id, found_ticket
  FROM public.find_resumable_repair_pickup(
    '84a63d82-0000-4000-8000-000000000001',
    'Ada@Example.com',
    '84a63d82-0000-4000-8000-000000000010'
  ) AS reclaim;

  IF found_id IS DISTINCT FROM '84a63d82-0000-4000-8000-000000000010'::uuid
    OR found_ticket IS DISTINCT FROM expected_ticket
  THEN
    RAISE EXCEPTION
      'p_repair_id must pin the claimed unpaid pickup; got id=% ticket=%',
      found_id,
      found_ticket;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.find_resumable_repair_pickup(
      '84a63d82-0000-4000-8000-000000000001',
      'Ada@Example.com',
      '84a63d82-0000-4000-8000-000000000010'
    ) AS reclaim
    WHERE reclaim.device_type = 'Smartphone'
      AND reclaim.device_model = 'iPhone 15'
      AND reclaim.customer_phone = '+2348012345678'
      AND reclaim.pickup_address = '12 Station Road, Osogbo'
  ) THEN
    RAISE EXCEPTION 'resumable reclaim must return pickup-binding fields';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.find_resumable_repair_pickup(
      '84a63d82-0000-4000-8000-000000000001',
      'other@example.com',
      '84a63d82-0000-4000-8000-000000000010'
    )
  ) THEN
    RAISE EXCEPTION 'mismatched email must not reclaim a pickup ticket';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'repair_pickup_receiver',
      'repair_pickup_receiver_context', 'server-quote',
      'repair_pickup_receiver_merchant_id',
      '84a63d82-0000-4000-8000-000000000099'
    )::text,
    true
  );

  IF EXISTS (
    SELECT 1
    FROM public.find_resumable_repair_pickup(
      '84a63d82-0000-4000-8000-000000000001',
      'Ada@Example.com',
      '84a63d82-0000-4000-8000-000000000010'
    )
  ) THEN
    RAISE EXCEPTION 'mismatched merchant capability must not reclaim a ticket';
  END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.find_resumable_repair_pickup(uuid, text, uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.find_resumable_repair_pickup(uuid, text, uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.find_resumable_repair_pickup(uuid, text, uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'repair_pickup_receiver',
    'public.find_resumable_repair_pickup(uuid, text, uuid)',
    'EXECUTE'
  ) OR to_regprocedure(
    'public.find_resumable_repair_pickup(uuid, text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'resumable pickup grant is not limited to scoped 3-arg role';
  END IF;
END;
$$;

ROLLBACK;

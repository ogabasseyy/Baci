BEGIN;
INSERT INTO public.merchants VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002');
INSERT INTO public.role_permissions VALUES ('sales_rep', '{}');
INSERT INTO public.staff_members VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000003', 'sales_rep', '{"orders":{"view":true,"edit":false}}', 'active'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000004', 'sales_rep', '{"orders":{"edit":true}}', 'active');
INSERT INTO public.orders (id, merchant_id, payment_method, payment_status, shipping_status)
SELECT ('40000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       '10000000-0000-4000-8000-000000000001', 'paystack', 'paid', 'processing'
FROM generate_series(1, 9) AS n;
INSERT INTO public.orders (id, merchant_id, payment_method, payment_status, shipping_status)
VALUES ('40000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000002',
        'paystack', 'paid', 'processing');

-- Exact incident regression: a paid, processing, non-REDVAULT order must
-- claim while the authenticated caller still has no private schema access.
DO $$
DECLARE
  result record;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO result FROM public.claim_order_shipment_booking(
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001', 900);
  IF result.claimed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Owner failed to claim paid order'; END IF;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.orders
                 WHERE id = '40000000-0000-4000-8000-000000000001'
                   AND shipment_booking_lock_token = '50000000-0000-4000-8000-000000000001'
                   AND shipment_booking_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Owner claim did not persist the requested lock';
  END IF;
  IF has_schema_privilege('authenticated', 'private', 'USAGE')
    OR has_function_privilege('authenticated', 'private.uba_redvault_partial_refund_blocks_booking(uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'private.uba_redvault_partial_refund_blocks_booking(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Repair widened access to the private refund implementation';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.claim_order_shipment_booking(uuid,uuid,uuid,integer)'::regprocedure) THEN
    RAISE EXCEPTION 'Booking claim bypasses RLS';
  END IF;
END;
$$;

-- Contention, timeout floor, stale recovery and duplicate-booking protection.
DO $$
DECLARE result record;
BEGIN
  SET LOCAL ROLE authenticated;
  SELECT * INTO result FROM public.claim_order_shipment_booking(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002', 0);
  IF result.claimed IS DISTINCT FROM false THEN RAISE EXCEPTION 'Competing claim stole active lock'; END IF;
  RESET ROLE;
  UPDATE public.orders SET shipment_booking_started_at = now() - interval '20 minutes'
  WHERE id = '40000000-0000-4000-8000-000000000001';
  SET LOCAL ROLE authenticated;
  SELECT * INTO result FROM public.claim_order_shipment_booking(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002', NULL);
  IF result.claimed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Stale lock was not reclaimed'; END IF;
  RESET ROLE;
  UPDATE public.orders SET tracking_number = 'TEST-BOOKED'
  WHERE id = '40000000-0000-4000-8000-000000000001';
  SET LOCAL ROLE authenticated;
  SELECT * INTO result FROM public.claim_order_shipment_booking(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', gen_random_uuid());
  IF result.claimed IS DISTINCT FROM false OR result.tracking_number <> 'TEST-BOOKED' THEN
    RAISE EXCEPTION 'Existing waybill did not prevent duplicate booking';
  END IF;
  RESET ROLE;
END;
$$;

-- RLS must continue to decide which staff may update the booking lock.
DO $$
DECLARE result record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000003', true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO result FROM public.claim_order_shipment_booking(
    '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', gen_random_uuid());
  IF result.claimed IS TRUE THEN RAISE EXCEPTION 'Read-only staff acquired a lock'; END IF;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.orders WHERE id = '40000000-0000-4000-8000-000000000002'
             AND shipment_booking_lock_token IS NOT NULL) THEN
    RAISE EXCEPTION 'Read-only staff persisted a lock';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000004', true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO result FROM public.claim_order_shipment_booking(
    '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', gen_random_uuid());
  IF result.claimed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Order editor failed to claim'; END IF;
  RESET ROLE;
END;
$$;

-- Cross-merchant and missing-identity claims fail closed.
DO $$
DECLARE caller text;
BEGIN
  FOREACH caller IN ARRAY ARRAY['20000000-0000-4000-8000-000000000002', ''] LOOP
    PERFORM set_config('request.jwt.claim.sub', caller, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.claim_order_shipment_booking(
        '40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', gen_random_uuid());
      RAISE EXCEPTION 'Unauthorized booking claim passed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.claim_order_shipment_booking(
      '40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', gen_random_uuid());
    RAISE EXCEPTION 'Missing JWT role bypassed authorization';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END;
$$;

-- Continues the transaction and fixtures from the permissions assertions.
DO $$
DECLARE
  actor text;
  merchant uuid;
  order_id uuid;
BEGIN
  IF has_function_privilege('anon', 'public.order_shipment_refund_blocks_booking(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous role can invoke refund probe';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  -- Independently callable probe rejects foreign owners, read-only staff,
  -- and a missing UID even though all share the authenticated DB role.
  FOREACH actor IN ARRAY ARRAY[
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003', ''
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub', actor, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.order_shipment_refund_blocks_booking(
        '40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001');
      RAISE EXCEPTION 'Unauthorized caller read refund probe';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
  -- Invalid order/merchant relationships and null inputs must not reveal
  -- another merchant's refund state or default to an unblocked result.
  FOR order_id, merchant IN SELECT * FROM (VALUES
    ('40000000-0000-4000-8000-000000000003'::uuid, '10000000-0000-4000-8000-000000000002'::uuid),
    ('40000000-0000-4000-8000-000000000099'::uuid, '10000000-0000-4000-8000-000000000001'::uuid),
    ('40000000-0000-4000-8000-000000000010'::uuid, '10000000-0000-4000-8000-000000000001'::uuid),
    (NULL::uuid, '10000000-0000-4000-8000-000000000001'::uuid),
    ('40000000-0000-4000-8000-000000000003'::uuid, NULL::uuid)
  ) AS cases(order_id, merchant) LOOP
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.order_shipment_refund_blocks_booking(order_id, merchant);
      RAISE EXCEPTION 'Invalid order/merchant probe passed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', '', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.order_shipment_refund_blocks_booking(
      '40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Missing role read refund probe';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;
  IF public.order_shipment_refund_blocks_booking(
    '40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Ordinary order is incorrectly refund-blocked';
  END IF;
  IF (SELECT claimed FROM public.claim_order_shipment_booking(
    '40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', gen_random_uuid())) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Service role failed to claim without a user UID';
  END IF;
  BEGIN
    PERFORM private.uba_redvault_partial_refund_blocks_booking(
      '40000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'Service role can directly execute private guard';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END;
$$;

INSERT INTO private.uba_redvault_payment_attempts VALUES
  ('60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000004');
INSERT INTO private.uba_redvault_refunds VALUES
  ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'merchandise_units', 'pending');

DO $$
DECLARE refund_state text;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
  FOREACH refund_state IN ARRAY ARRAY['pending', 'processing', 'needs_reconciliation', 'processed'] LOOP
    UPDATE private.uba_redvault_refunds SET state = refund_state
    WHERE id = '70000000-0000-4000-8000-000000000001';
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.claim_order_shipment_booking(
        '40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', gen_random_uuid());
      RAISE EXCEPTION 'Unsettled refund did not block booking';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'order_refund_pending_for_shipment' THEN RAISE; END IF;
    END;
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM public.orders WHERE id = '40000000-0000-4000-8000-000000000004'
               AND shipment_booking_lock_token IS NOT NULL) THEN
      RAISE EXCEPTION 'Refund-blocked claim persisted a lock';
    END IF;
  END LOOP;
  INSERT INTO private.uba_redvault_refund_lifecycle VALUES
    ('70000000-0000-4000-8000-000000000001', 'released');
  SET LOCAL ROLE authenticated;
  IF (SELECT claimed FROM public.claim_order_shipment_booking(
    '40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', gen_random_uuid())) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Reconciled refund prevented booking';
  END IF;
  RESET ROLE;
END;
$$;

-- Preserve no-row semantics and payment-state guards after the repair.
UPDATE public.orders SET payment_method = 'uba_redvault'
WHERE id = '40000000-0000-4000-8000-000000000005';
UPDATE public.orders SET payment_method = 'pod', payment_status = 'unpaid'
WHERE id = '40000000-0000-4000-8000-000000000006';
UPDATE public.orders SET payment_method = 'uba_redvault', payment_status = 'unpaid'
WHERE id = '40000000-0000-4000-8000-000000000007';
UPDATE public.orders SET shipping_status = 'cancelled'
WHERE id = '40000000-0000-4000-8000-000000000008';
UPDATE public.orders SET payment_status = 'refunded'
WHERE id = '40000000-0000-4000-8000-000000000009';
DO $$
DECLARE order_id uuid; expected text;
BEGIN
  SET LOCAL ROLE authenticated;
  IF (SELECT claimed FROM public.claim_order_shipment_booking(
    '40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', gen_random_uuid())) IS DISTINCT FROM true
    OR (SELECT claimed FROM public.claim_order_shipment_booking(
    '40000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', gen_random_uuid())) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Paid REDVAULT or unpaid POD order failed to claim';
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_order_shipment_booking(
    '40000000-0000-4000-8000-000000000099', '10000000-0000-4000-8000-000000000001', gen_random_uuid())) THEN
    RAISE EXCEPTION 'Missing order no longer returns an empty result';
  END IF;
  FOR order_id, expected IN SELECT * FROM (VALUES
    ('40000000-0000-4000-8000-000000000007'::uuid, 'order_redvault_unpaid_for_shipment'),
    ('40000000-0000-4000-8000-000000000008'::uuid, 'order_cancelled_for_shipment'),
    ('40000000-0000-4000-8000-000000000009'::uuid, 'order_refunded_for_shipment')
  ) AS cases(order_id, expected) LOOP
    BEGIN
      PERFORM public.claim_order_shipment_booking(order_id, '10000000-0000-4000-8000-000000000001', gen_random_uuid());
      RAISE EXCEPTION 'Payment-state guard did not reject booking';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> expected THEN RAISE; END IF;
    END;
  END LOOP;
  RESET ROLE;
END;
$$;
ROLLBACK;

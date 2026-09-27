-- REGRESSION TEST: the anon-granted guest payment snapshot exposes
-- verification fields only. Because anon can invoke the function
-- directly through Supabase/PostgREST past the API route's response
-- filtering, raw provider payloads (gateway_response, transaction
-- metadata) and internal fee data (platform_fee) must never appear in
-- its output columns.
--
-- USAGE:
--   supabase test db supabase/tests/guest_payment_reference_snapshot_minimal.sql

BEGIN;

DO $snapshot_columns$
DECLARE
  v_out_columns text[];
  v_expected text[] := ARRAY[
    'transaction_id',
    'order_id',
    'merchant_id',
    'amount',
    'currency',
    'transaction_status',
    'gateway',
    'gateway_reference',
    'order_number',
    'order_payment_status',
    'order_shipping_status',
    'order_total'
  ];
BEGIN
  SELECT array_agg(p.parameter_name::text ORDER BY p.ordinal_position)
    INTO v_out_columns
    FROM information_schema.parameters AS p
   WHERE p.specific_schema = 'public'
     AND p.specific_name IN (
       SELECT s.specific_name
         FROM information_schema.routines AS s
        WHERE s.routine_schema = 'public'
          AND s.routine_name = 'get_guest_payment_reference_snapshot'
     )
     AND p.parameter_mode = 'OUT';

  IF v_out_columns IS NULL THEN
    RAISE EXCEPTION 'get_guest_payment_reference_snapshot is missing';
  END IF;

  IF v_out_columns <> v_expected THEN
    RAISE EXCEPTION
      'guest snapshot output columns changed: %', v_out_columns;
  END IF;
END;
$snapshot_columns$;

ROLLBACK;

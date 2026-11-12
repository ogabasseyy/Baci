-- REGRESSION TEST (behaviour): the PiggyVest payment state of an IMEI lookup,
-- which the IMEI money guards read (migration 20261112190000_imei_piggyvest_wallet_pay).
-- Registered in replay-registry folder 20261112190000_imei_piggyvest_wallet_pay.
\set ON_ERROR_STOP on
\ir piggyvest_wallet_pay.fixture.inc.sql

DO $behaviour$
DECLARE
  c_customer constant uuid := 'f9a10000-0000-4000-8000-000000000003';
  c_merchant constant uuid := 'f9a10000-0000-4000-8000-000000000002';
  c_lookup constant text := 'f9a10000-0000-4000-8000-0000000000a1';
  v_op text;
  v_late text;
BEGIN
  PERFORM pg_temp.wp_collection();
  -- No payment: no PiggyVest state.
  PERFORM pg_temp.wp_assert(piggyvest_primary.imei_wallet_payment_state(c_lookup::uuid, c_customer, c_merchant, 1000) IS NULL,
    'a lookup with no payment has a state');
  -- Issued only (no PIN, nothing moved): still none.
  v_op := pg_temp.wp_issue(c_lookup, 100000) ->> 'operationId';
  PERFORM pg_temp.wp_assert(piggyvest_primary.imei_wallet_payment_state(c_lookup::uuid, c_customer, c_merchant, 1000) IS NULL,
    'an issued payment counts as money');
  -- Reserved / dispatched: charged.
  UPDATE piggyvest_primary.wallet_payments SET expires_at = pg_catalog.clock_timestamp() - interval '1 second' WHERE id = v_op::uuid;
  v_op := pg_temp.wp_dispatched(c_lookup);
  PERFORM pg_temp.wp_assert(piggyvest_primary.imei_wallet_payment_state(c_lookup::uuid, c_customer, c_merchant, 1000) = 'charged',
    'a dispatched payment is not charged');
  -- Another customer, merchant or price never matches.
  PERFORM pg_temp.wp_assert(piggyvest_primary.imei_wallet_payment_state(c_lookup::uuid, 'f9a10000-0000-4000-8000-0000000000ff', c_merchant, 1000) IS NULL,
    'another customer matched');
  PERFORM pg_temp.wp_assert(piggyvest_primary.imei_wallet_payment_state(c_lookup::uuid, c_customer, 'f9a10000-0000-4000-8000-0000000000ff', 1000) IS NULL,
    'another merchant matched');
  PERFORM pg_temp.wp_assert(piggyvest_primary.imei_wallet_payment_state(c_lookup::uuid, c_customer, c_merchant, 999) IS NULL,
    'another price matched');
  PERFORM pg_temp.wp_assert(piggyvest_primary.imei_wallet_payment_state(c_lookup::uuid, c_customer, c_merchant, 999.995) IS NULL,
    'a fractional-kobo price matched');
  -- Confirmed but not yet claimed: charged; claimed: delivering.
  PERFORM pg_temp.wp_settle(pg_temp.wp_pay_proof(v_op, 'txn-imei-1'));
  PERFORM pg_temp.wp_assert(piggyvest_primary.imei_wallet_payment_state(c_lookup::uuid, c_customer, c_merchant, 1000) = 'charged',
    'a confirmed, unclaimed payment is not charged');
  PERFORM pg_temp.wp_claim(v_op);
  PERFORM pg_temp.wp_assert(piggyvest_primary.imei_wallet_payment_state(c_lookup::uuid, c_customer, c_merchant, 1000) = 'delivering',
    'a claimed payment is not delivering');
  -- Failed delivery: refund owed, and that wins over everything else.
  PERFORM pg_temp.wp_finish(v_op, 'failed');
  PERFORM pg_temp.wp_assert(piggyvest_primary.imei_wallet_payment_state(c_lookup::uuid, c_customer, c_merchant, 1000) = 'refund_owed',
    'a failed delivery owes no refund');
  -- Only the IMEI purpose counts.
  PERFORM pg_temp.wp_issue(c_lookup, 100000, 'vtu');
  PERFORM pg_temp.wp_assert(piggyvest_primary.imei_wallet_payment_state(c_lookup::uuid, c_customer, c_merchant, 1000) = 'refund_owed',
    'a VTU payment changed the IMEI state');
  -- A newer payment being delivered outranks an older refunded attempt.
  v_late := pg_temp.wp_dispatched(c_lookup);
  PERFORM pg_temp.wp_settle(pg_temp.wp_pay_proof(v_late, 'txn-imei-2'));
  PERFORM pg_temp.wp_claim(v_late);
  PERFORM pg_temp.wp_assert(piggyvest_primary.imei_wallet_payment_state(c_lookup::uuid, c_customer, c_merchant, 1000) = 'delivering',
    'an older refunded attempt outranked the payment being delivered');
  -- The drain's delivered check: only a completed lookup of the same
  -- customer, merchant and price counts, and only for a confirmed payment.
  PERFORM pg_temp.wp_assert(NOT piggyvest_primary.imei_wallet_payment_delivered(
    'f9a10000-0000-4000-8000-000000000006'::uuid, 'staging', v_late::uuid), 'a payment with no lookup was delivered');
  INSERT INTO public.imei_lookups (id, customer_id, merchant_id, tier, imei_hash, idempotency_key, amount_ngn, status)
  VALUES (c_lookup::uuid, c_customer, c_merchant, 'basic', 'hash', 'f9a10000-0000-4000-8000-0000000000b1', 999, 'completed');
  PERFORM pg_temp.wp_assert(NOT piggyvest_primary.imei_wallet_payment_delivered(
    'f9a10000-0000-4000-8000-000000000006'::uuid, 'staging', v_late::uuid), 'a lookup at another price was delivered');
  UPDATE public.imei_lookups SET amount_ngn = 1000, status = 'pending' WHERE id = c_lookup::uuid;
  PERFORM pg_temp.wp_assert(NOT piggyvest_primary.imei_wallet_payment_delivered(
    'f9a10000-0000-4000-8000-000000000006'::uuid, 'staging', v_late::uuid), 'a pending lookup was delivered');
  UPDATE public.imei_lookups SET status = 'completed' WHERE id = c_lookup::uuid;
  PERFORM pg_temp.wp_assert(piggyvest_primary.imei_wallet_payment_delivered(
    'f9a10000-0000-4000-8000-000000000006'::uuid, 'staging', v_late::uuid), 'a completed lookup was not delivered');
  PERFORM pg_temp.wp_assert(NOT piggyvest_primary.imei_wallet_payment_delivered(
    'f9a10000-0000-4000-8000-000000000006'::uuid, 'staging', v_op::uuid), 'a payment whose refund is owed counts as delivered');
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('authenticated',
    'piggyvest_primary.imei_wallet_payment_delivered(uuid,text,uuid)', 'EXECUTE'), 'authenticated can read delivered');
  PERFORM pg_temp.wp_assert(pg_catalog.has_function_privilege('piggyvest_primary_authorizer',
    'piggyvest_primary.imei_wallet_payment_delivered(uuid,text,uuid)', 'EXECUTE'), 'the worker can not read delivered');
  -- Client roles can not call it.
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('authenticated',
    'piggyvest_primary.imei_wallet_payment_state(uuid,uuid,uuid,numeric)', 'EXECUTE'), 'authenticated can read state');
END;
$behaviour$;

ROLLBACK;

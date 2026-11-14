-- REGRESSION TEST (behaviour): the IMEI money guards accept a PiggyVest wallet
-- payment as the proof of payment and refund, and nothing weaker
-- (migration 20261112190000_imei_piggyvest_wallet_pay). Signed calls, like the
-- other imei_lookup_access suites. Registered in replay-registry folder
-- 20261112190000_imei_piggyvest_wallet_pay.
\set ON_ERROR_STOP on
\ir piggyvest_wallet_pay.fixture.inc.sql

INSERT INTO private.imei_access_secrets(singleton, secret)
  VALUES (true, 'test-imei-access-secret-at-least-32-bytes')
  ON CONFLICT (singleton) DO UPDATE SET secret = excluded.secret;
SELECT set_config('request.jwt.claim.sub', 'f9a10000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f9a10000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);

CREATE FUNCTION pg_temp.imei_call(operation text, args jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE payload text; issued bigint := floor(extract(epoch FROM clock_timestamp()));
BEGIN
  payload := jsonb_build_object('version', 1, 'actor', 'f9a10000-0000-4000-8000-000000000001',
    'customer', 'f9a10000-0000-4000-8000-000000000003',
    'merchant', 'f9a10000-0000-4000-8000-000000000002', 'operation', operation,
    'issuedAt', issued, 'expiresAt', issued + 120, 'args', args)::text;
  RETURN public.imei_lookup_access(payload, encode(extensions.hmac('baci:imei-access:v1:' || payload,
    'test-imei-access-secret-at-least-32-bytes', 'sha256'), 'hex'));
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.imei_call(text, jsonb) TO PUBLIC;
-- Money-guard refusals come back as SQLSTATE 42501 with a named message.
CREATE FUNCTION pg_temp.imei_refused(operation text, args jsonb, expected text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.imei_call(operation, args);
  RETURN false;
EXCEPTION WHEN SQLSTATE '42501' THEN
  RETURN SQLERRM = expected;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.imei_refused(text, jsonb, text) TO PUBLIC;
CREATE FUNCTION pg_temp.new_lookup() RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.imei_call('insert_pending', jsonb_build_object(
    'customer_id', 'f9a10000-0000-4000-8000-000000000003', 'merchant_id', 'f9a10000-0000-4000-8000-000000000002',
    'tier', 'simLock', 'imei_hash', repeat('b', 64), 'device_category', 'smartphone',
    'idempotency_key', gen_random_uuid(), 'amount_ngn', 500, 'status', 'pending')) ->> 'id';
$$;
GRANT EXECUTE ON FUNCTION pg_temp.new_lookup() TO PUBLIC;
CREATE FUNCTION pg_temp.cache_patch(p_status text, p_http integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('patch', jsonb_build_object('status', p_status, 'cached_status', p_http,
    'cached_response', jsonb_build_object('success', p_status = 'completed')));
$$;
GRANT EXECUTE ON FUNCTION pg_temp.cache_patch(text, integer) TO PUBLIC;

SELECT pg_temp.wp_collection();
SET LOCAL ROLE authenticated;
SELECT set_config('test.paid_lookup', pg_temp.new_lookup(), true);
SELECT set_config('test.failed_lookup', pg_temp.new_lookup(), true);
DO $$
DECLARE id text := current_setting('test.paid_lookup');
BEGIN
  -- Nothing paid: completion is refused exactly as before.
  IF NOT pg_temp.imei_refused('cache', pg_temp.cache_patch('completed', 200) || jsonb_build_object('lookup_id', id),
    'imei_access_completion_without_debit') THEN
    RAISE EXCEPTION 'an unpaid lookup completed';
  END IF;
END $$;
RESET ROLE;

-- REGRESSION (Codex P1): a lookup whose PiggyVest payment was only issued
-- (the operation may already be with a client) is never deleted; a lookup
-- with no payment at all still can be.
SET LOCAL ROLE authenticated;
SELECT set_config('test.issued_lookup', pg_temp.new_lookup(), true);
SELECT set_config('test.bare_lookup', pg_temp.new_lookup(), true);
RESET ROLE;
SELECT pg_temp.wp_issue(current_setting('test.issued_lookup'), 50000);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF NOT pg_temp.imei_refused('delete_pending',
    jsonb_build_object('lookup_id', current_setting('test.issued_lookup')),
    'imei_access_charged_lookup_delete_denied') THEN
    RAISE EXCEPTION 'a lookup with an issued PiggyVest payment was deleted';
  END IF;
  IF pg_temp.imei_refused('delete_pending',
    jsonb_build_object('lookup_id', current_setting('test.bare_lookup')),
    'imei_access_charged_lookup_delete_denied') THEN
    RAISE EXCEPTION 'a lookup with no payment could not be deleted';
  END IF;
END $$;
RESET ROLE;

-- A PiggyVest payment of exactly the price (500 NGN = 50000 kobo) is sent.
SELECT set_config('test.paid_op', pg_temp.wp_dispatched(current_setting('test.paid_lookup'), 50000), true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE id text := current_setting('test.paid_lookup');
BEGIN
  IF NOT pg_temp.imei_refused('delete_pending', jsonb_build_object('lookup_id', id),
    'imei_access_charged_lookup_delete_denied') THEN
    RAISE EXCEPTION 'a lookup with a PiggyVest payment in flight was deleted';
  END IF;
  IF NOT pg_temp.imei_refused('cache', pg_temp.cache_patch('failed_error', 502) || jsonb_build_object('lookup_id', id),
    'imei_access_charged_lookup_failure_denied') THEN
    RAISE EXCEPTION 'a charged lookup was failed without a refund';
  END IF;
  -- Sent but not confirmed: still no delivery.
  IF NOT pg_temp.imei_refused('cache', pg_temp.cache_patch('completed', 200) || jsonb_build_object('lookup_id', id),
    'imei_access_completion_without_debit') THEN
    RAISE EXCEPTION 'a lookup completed on an unconfirmed payment';
  END IF;
END $$;
RESET ROLE;

-- Confirmed and claimed for delivery: completion is allowed.
SELECT pg_temp.wp_settle(pg_temp.wp_pay_proof(current_setting('test.paid_op'), 'txn-imei-paid', 50000));
SELECT pg_temp.wp_claim(current_setting('test.paid_op'));
SET LOCAL ROLE authenticated;
DO $$
DECLARE id text := current_setting('test.paid_lookup'); r jsonb;
BEGIN
  PERFORM pg_temp.imei_call('cache', pg_temp.cache_patch('completed', 200) || jsonb_build_object('lookup_id', id));
  r := pg_temp.imei_call('read_status', jsonb_build_object('lookup_id', id));
  IF r ->> 'status' <> 'completed' THEN RAISE EXCEPTION 'paid lookup did not complete: %', r; END IF;
END $$;
RESET ROLE;

-- REGRESSION (Codex P1): a delivered check is never refunded, even by a
-- reclaim that read the lookup before the result was saved.
DO $$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN
    PERFORM pg_temp.wp_finish(current_setting('test.paid_op'), 'failed');
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM = 'imei_wallet_payment_already_delivered';
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'a delivered IMEI check was moved to refund_owed';
  END IF;
  IF pg_temp.wp_fulfilment(current_setting('test.paid_op')) <> 'claimed' THEN
    RAISE EXCEPTION 'the delivered payment left its claim';
  END IF;
  -- REGRESSION (Muse): only the payment's OWN delivery blocks its refund. A
  -- completed lookup at another price is not this payment's (a savepoint
  -- keeps the paid lookup as it was for the steps below).
  BEGIN
    UPDATE public.imei_lookups SET amount_ngn = 400
     WHERE id = current_setting('test.paid_lookup')::uuid;
    IF pg_temp.wp_finish(current_setting('test.paid_op'), 'failed') <> 'refund_owed' THEN
      RAISE EXCEPTION 'a lookup at another price blocked the refund';
    END IF;
    RAISE EXCEPTION 'scoped-refund-ok' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;
END $$;

-- A failed delivery: refunded_error needs the owed PiggyVest refund.
SELECT set_config('test.failed_op', pg_temp.wp_dispatched(current_setting('test.failed_lookup'), 50000), true);
SELECT pg_temp.wp_settle(pg_temp.wp_pay_proof(current_setting('test.failed_op'), 'txn-imei-failed', 50000));
SELECT pg_temp.wp_claim(current_setting('test.failed_op'));
SET LOCAL ROLE authenticated;
DO $$
DECLARE id text := current_setting('test.failed_lookup');
BEGIN
  IF NOT pg_temp.imei_refused('cache', pg_temp.cache_patch('refunded_error', 502) || jsonb_build_object('lookup_id', id),
    'imei_access_refund_without_credit') THEN
    RAISE EXCEPTION 'a lookup was marked refunded before any refund was owed';
  END IF;
END $$;
RESET ROLE;
SELECT pg_temp.wp_finish(current_setting('test.failed_op'), 'failed');
SET LOCAL ROLE authenticated;
DO $$
DECLARE id text := current_setting('test.failed_lookup'); r jsonb;
BEGIN
  -- Muse: once the PiggyVest refund is owed the check stays refunded_*,
  -- never a plain failure that hides the refund.
  IF NOT pg_temp.imei_refused('cache', pg_temp.cache_patch('failed_error', 502) || jsonb_build_object('lookup_id', id),
    'imei_access_charged_lookup_failure_denied') THEN
    RAISE EXCEPTION 'a lookup owing a PiggyVest refund was failed without it';
  END IF;
  PERFORM pg_temp.imei_call('cache', pg_temp.cache_patch('refunded_error', 502) || jsonb_build_object('lookup_id', id));
  r := pg_temp.imei_call('read_status', jsonb_build_object('lookup_id', id));
  IF r ->> 'status' <> 'refunded_error' THEN RAISE EXCEPTION 'failed lookup not refunded: %', r; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT pg_catalog.count(*) FROM piggyvest_primary.wallet_payment_refunds
       WHERE payment_id = current_setting('test.failed_op')::uuid) <> 1 THEN
    RAISE EXCEPTION 'the failed lookup did not owe exactly one refund';
  END IF;
END $$;

-- REGRESSION (Codex P1): a lookup that finished after the pay step read it
-- as pending never takes a new payment; the PIN proof is not spent.
SET LOCAL ROLE authenticated;
SELECT set_config('test.late_lookup', pg_temp.new_lookup(), true);
RESET ROLE;
DO $$
DECLARE
  v_lookup text := current_setting('test.late_lookup');
  v_op text := pg_temp.wp_issue(v_lookup, 50000) ->> 'operationId';
  v_proof text := pg_temp.wp_proof('late-' || v_op, 'wallet_pay', 50000, pg_temp.wp_key(v_op, v_lookup));
  v_refused boolean := false;
BEGIN
  UPDATE public.imei_lookups SET status = 'refunded_error' WHERE id = v_lookup::uuid;
  BEGIN
    PERFORM pg_temp.wp_reserve(v_op, v_proof);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_refused := SQLERRM = 'imei_check_already_finished';
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'a finished IMEI check took a new payment'; END IF;
  IF pg_temp.wp_state(v_op) <> 'issued' OR pg_temp.wp_spent('late-' || v_op) THEN
    RAISE EXCEPTION 'a refused reservation moved the payment or spent the PIN proof';
  END IF;
  -- Still pending: the reservation goes through.
  UPDATE public.imei_lookups SET status = 'pending' WHERE id = v_lookup::uuid;
  IF pg_temp.wp_reserve(v_op, v_proof) ->> 'status' <> 'claimed' THEN
    RAISE EXCEPTION 'a pending IMEI check could not be paid';
  END IF;
END $$;

ROLLBACK;

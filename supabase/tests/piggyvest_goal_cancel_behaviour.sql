-- REGRESSION TEST (behaviour): goal cancel refund (migration
-- 20261103085004_piggyvest_goal_cancel_refund).
--
-- Synthetic, transaction-local fixture; the final ROLLBACK removes it. Proofs
-- are written directly as owner rows with label-derived test tokens (no PIN is
-- typed, so no pepper or attestation is involved); the spend point under test
-- reads them like real ones. Registered in the replay registry folder
-- 20261103085004_piggyvest_goal_cancel_refund.

BEGIN;

UPDATE piggyvest_primary.integrations SET executor_login = 'retired-' || id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.savings_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.inflow_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;

INSERT INTO auth.users (id, email) VALUES
  ('f3860000-0000-4000-8000-000000000001', 'piggyvest-goalcancel@example.test');
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3860000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000001',
   'piggyvest-goalcancel@example.test', 'PiggyVest Goal Cancel Fixture', 'piggyvest-goalcancel-fixture');
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES
  ('f3860000-0000-4000-8000-000000000003', 'f3860000-0000-4000-8000-000000000002',
   'f3860000-0000-4000-8000-000000000001', 'piggyvest-goalcancel-customer@example.test');
INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity) VALUES
  ('f3860000-0000-4000-8000-000000000004', 'f3860000-0000-4000-8000-000000000002',
   'Synthetic goal cancel product', 10000, 'active', 1);
INSERT INTO public.customer_savings_goals (
  id, merchant_id, customer_id, product_id, title, target_amount, current_amount,
  contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
  terms_accepted_at, non_withdrawable_accepted_at
) VALUES (
  'f3860000-0000-4000-8000-000000000005', 'f3860000-0000-4000-8000-000000000002',
  'f3860000-0000-4000-8000-000000000003', 'f3860000-0000-4000-8000-000000000004',
  'Synthetic goal cancel goal', 10000, 2500, 1000, 'daily', current_date, current_date + 30,
  'manual', now(), now());
INSERT INTO piggyvest_primary.integrations
  (id, merchant_id, business_id, environment, executor_login, enabled)
VALUES ('f3860000-0000-4000-8000-000000000006', 'f3860000-0000-4000-8000-000000000002',
  'synthetic-goalcancel-business', 'staging', SESSION_USER, true);
INSERT INTO piggyvest_primary.savings_authorities (integration_id, executor_login, enabled)
VALUES ('f3860000-0000-4000-8000-000000000006', SESSION_USER, true);
INSERT INTO piggyvest_primary.inflow_authorities (integration_id, executor_login, enabled)
VALUES ('f3860000-0000-4000-8000-000000000006', SESSION_USER, true);
INSERT INTO piggyvest_primary.onboarding_intents (
  id, integration_id, merchant_id, customer_id, user_id, request_fingerprint, state,
  provider_customer_id, provider_wallet_id
) VALUES (
  'f3860000-0000-4000-8000-000000000007', 'f3860000-0000-4000-8000-000000000006',
  'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003',
  'f3860000-0000-4000-8000-000000000001', repeat('d', 64), 'accepted',
  'synthetic-goalcancel-customer', 'synthetic-goalcancel-main');
INSERT INTO piggyvest_primary.savings_destinations (integration_id, goal_id, intent_id, provider_wallet_id, enabled)
VALUES ('f3860000-0000-4000-8000-000000000006', 'f3860000-0000-4000-8000-000000000005',
  'f3860000-0000-4000-8000-000000000007', 'synthetic-goalcancel-goal-wallet', true);
INSERT INTO public.customer_wallets (id, customer_id, merchant_id, available_balance) VALUES
  ('f3860000-0000-4000-8000-000000000008', 'f3860000-0000-4000-8000-000000000003',
   'f3860000-0000-4000-8000-000000000002', 1000);
INSERT INTO public.customer_wallet_transactions (
  id, wallet_id, customer_id, merchant_id, type, amount, balance_after, status
) VALUES (
  'f3860000-0000-4000-8000-000000000009', 'f3860000-0000-4000-8000-000000000008',
  'f3860000-0000-4000-8000-000000000003', 'f3860000-0000-4000-8000-000000000002',
  'adjustment', 1000, 1000, 'completed');
INSERT INTO wallet_pin_private.merchant_authorities (merchant_id, enabled)
VALUES ('f3860000-0000-4000-8000-000000000002', true);
INSERT INTO wallet_pin_private.customer_pins (
  customer_id, user_id, merchant_id, kdf_version, pepper_id, salt, pin_hash)
VALUES (
  'f3860000-0000-4000-8000-000000000003', 'f3860000-0000-4000-8000-000000000001',
  'f3860000-0000-4000-8000-000000000002', 1,
  pg_catalog.substr(pg_catalog.sha256(pg_catalog.convert_to('goalcancel-pepper', 'UTF8')), 1, 8),
  pg_catalog.substr(pg_catalog.sha256(pg_catalog.convert_to('goalcancel-salt', 'UTF8')), 1, 16),
  pg_catalog.sha256(pg_catalog.convert_to('goalcancel-hash', 'UTF8')));
SELECT set_config('test.gc_scope', jsonb_build_object(
  'merchantId', 'f3860000-0000-4000-8000-000000000002',
  'customerId', 'f3860000-0000-4000-8000-000000000003',
  'userId', 'f3860000-0000-4000-8000-000000000001',
  'integrationId', 'f3860000-0000-4000-8000-000000000006',
  'businessId', 'synthetic-goalcancel-business', 'environment', 'staging')::text, true);

CREATE FUNCTION pg_temp.gc_token(p_label text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_label, 'UTF8')), 'hex');
$$;
CREATE FUNCTION pg_temp.gc_issue(
  p_label text, p_purpose text, p_amount bigint, p_key_text text, p_age_seconds integer DEFAULT 0)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_issued timestamptz := pg_catalog.clock_timestamp() - (p_age_seconds || ' seconds')::interval;
BEGIN
  INSERT INTO wallet_pin_private.proofs (
    token_sha256, customer_id, merchant_id, purpose, amount_kobo,
    idempotency_key_sha256, issued_at, expires_at)
  VALUES (
    pg_catalog.sha256(pg_catalog.decode(pg_temp.gc_token(p_label), 'hex')),
    'f3860000-0000-4000-8000-000000000003', 'f3860000-0000-4000-8000-000000000002',
    p_purpose, p_amount,
    pg_catalog.sha256(pg_catalog.convert_to(p_key_text, 'UTF8')),
    v_issued, v_issued + interval '120 seconds');
  RETURN pg_temp.gc_token(p_label);
END;
$$;
CREATE FUNCTION pg_temp.gc_scope() RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_catalog.current_setting('test.gc_scope')::jsonb;
$$;
CREATE FUNCTION pg_temp.gc_issue_op() RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.issue_goal_cancel(pg_temp.gc_scope(), 'f3860000-0000-4000-8000-000000000005'::uuid);
$$;
CREATE FUNCTION pg_temp.gc_reserve(p_op text, p_proof text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.reserve_goal_cancel_with_pin(pg_temp.gc_scope(),
    pg_catalog.jsonb_build_object('goalId', 'f3860000-0000-4000-8000-000000000005', 'operationId', p_op), p_proof);
$$;
CREATE FUNCTION pg_temp.gc_proof(p_op text, p_status text DEFAULT 'success') RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_catalog.jsonb_build_object(
    'operationId', p_op, 'providerTransactionId', 'synthetic-gc-txn-' || p_status || '-' || p_op,
    'reference', (SELECT reference FROM piggyvest_primary.goal_cancel_operations WHERE id = p_op::uuid),
    'amountKobo', 250000, 'sourceWalletId', 'synthetic-goalcancel-goal-wallet',
    'destinationWalletId', 'synthetic-goalcancel-main', 'businessId', 'synthetic-goalcancel-business');
$$;
CREATE FUNCTION pg_temp.gc_assert(p_ok boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'goal cancel behaviour: %', p_message; END IF;
END;
$$;
CREATE FUNCTION pg_temp.gc_state(p_op text) RETURNS text LANGUAGE sql AS $$
  SELECT state FROM piggyvest_primary.goal_cancel_operations WHERE id = p_op::uuid;
$$;
CREATE FUNCTION pg_temp.gc_spent(p_label text) RETURNS boolean LANGUAGE sql AS $$
  SELECT consumed_at IS NOT NULL FROM wallet_pin_private.proofs
   WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(pg_temp.gc_token(p_label), 'hex'));
$$;
CREATE FUNCTION pg_temp.gc_key(p_op text) RETURNS text LANGUAGE sql AS $$
  SELECT 'f3860000-0000-4000-8000-000000000005:cancel:' || p_op;
$$;

DO $behaviour$
DECLARE
  c_goal constant text := 'f3860000-0000-4000-8000-000000000005';
  c_invented constant text := 'f3860000-0000-4000-8000-0000000000ee';
  c_other constant text := 'f3860000-0000-4000-8000-0000000000ef';
  v_scope jsonb := pg_temp.gc_scope();
  v_issue jsonb;
  v_issue2 jsonb;
  v_op text;
  v_op2 text;
  v_result jsonb;
  v_text text;
  v_ctx text;
  v_line integer;
BEGIN
  -- 0. The key text digest matches the literal asserted by the web tests
  -- (goal-pin-binding.test.ts), so the two sides cannot drift.
  PERFORM pg_temp.gc_assert(
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:cancel:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'UTF8')), 'hex')
      = '2caa79006f7f847e307e48c9d4a52d49b96fc8d0b7d761b8adb79888e42c5143',
    'cancel key digest drifted from the web binding');

  -- 1. The server issues the operation id; a double tap gets the same one.
  v_issue := pg_temp.gc_issue_op();
  PERFORM pg_temp.gc_assert(v_issue ->> 'status' = 'issued', 'issue: ' || v_issue::text);
  v_op := v_issue ->> 'operationId';
  v_issue2 := pg_temp.gc_issue_op();
  PERFORM pg_temp.gc_assert(v_issue2 ->> 'operationId' = v_op, 'a second issue minted a new id');
  PERFORM pg_temp.gc_assert(
    (SELECT pg_catalog.count(*) FROM piggyvest_primary.goal_cancel_operations) = 1,
    'a second issue created a second row');

  -- 1b. The PIN verify route pre-check: only a live issued id for this goal.
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.check_goal_cancel_issued(v_scope, c_goal::uuid, v_op::uuid),
    'a live issued id was not recognised');
  PERFORM pg_temp.gc_assert(
    NOT piggyvest_primary.check_goal_cancel_issued(v_scope, c_goal::uuid, c_invented::uuid)
    AND NOT piggyvest_primary.check_goal_cancel_issued(v_scope, c_invented::uuid, v_op::uuid),
    'an invented operation or goal id was recognised');

  -- 1c. A goal bound to a PiggyVest goal wallet refuses new legacy money and
  -- order redemptions outright, and a goal that ALREADY holds either is sent
  -- to review instead of having the whole provider balance refunded.
  BEGIN
    INSERT INTO public.customer_savings_contributions
      (goal_id, merchant_id, customer_id, amount, source_type, status, idempotency_key)
    VALUES (c_goal::uuid, 'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003',
      10, 'wallet', 'completed', 'synthetic-goalcancel-legacy-new');
    RAISE EXCEPTION 'a legacy contribution reached a primary goal' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gc_assert(SQLERRM = 'savings_goal_primary_not_allocatable',
      'legacy contribution guard raised another error: ' || SQLERRM);
  END;
  -- PiggyVest's own settlement contribution is marked and stays allowed.
  INSERT INTO public.customer_savings_contributions
    (goal_id, merchant_id, customer_id, amount, source_type, status, idempotency_key, metadata)
  VALUES (c_goal::uuid, 'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003',
    10, 'wallet', 'completed', 'synthetic-goalcancel-primary-settlement',
    '{"provider": "piggyvest"}'::jsonb);
  PERFORM pg_temp.gc_assert(NOT piggyvest_primary.goal_cancel_needs_review(c_goal::uuid),
    'a PiggyVest settlement contribution was treated as legacy money');
  DELETE FROM public.customer_savings_contributions
   WHERE idempotency_key = 'synthetic-goalcancel-primary-settlement';
  BEGIN
    INSERT INTO public.customer_savings_redemptions
      (goal_id, merchant_id, customer_id, order_id, amount, idempotency_key)
    VALUES (c_goal::uuid, 'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003',
      'f3860000-0000-4000-8000-0000000000f4', 1, 'synthetic-goalcancel-redemption-primary');
    RAISE EXCEPTION 'a primary goal was redeemed' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gc_assert(SQLERRM = 'savings_goal_primary_not_redeemable',
      'redemption guard raised another error for a primary goal: ' || SQLERRM);
  END;
  -- Data that predates the guards: written with triggers off (replica role).
  PERFORM pg_catalog.set_config('session_replication_role', 'replica', true);
  INSERT INTO public.customer_savings_contributions
    (goal_id, merchant_id, customer_id, amount, source_type, status, idempotency_key)
  VALUES (c_goal::uuid, 'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003',
    10, 'wallet', 'completed', 'synthetic-goalcancel-legacy-old');
  PERFORM pg_catalog.set_config('session_replication_role', 'origin', true);
  PERFORM pg_temp.gc_assert(piggyvest_primary.goal_cancel_needs_review(c_goal::uuid),
    'a legacy contribution did not need review');
  PERFORM pg_temp.gc_issue('review', 'goal_cancel', 1, pg_temp.gc_key(v_op));
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('review'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'needs_review',
    'a mixed goal was reserved: ' || v_result::text);
  PERFORM pg_temp.gc_assert(NOT pg_temp.gc_spent('review') AND pg_temp.gc_state(v_op) = 'issued',
    'a needs-review refusal spent the proof or moved the attempt');
  PERFORM pg_catalog.set_config('session_replication_role', 'replica', true);
  DELETE FROM public.customer_savings_contributions WHERE idempotency_key = 'synthetic-goalcancel-legacy-old';
  PERFORM pg_catalog.set_config('session_replication_role', 'origin', true);
  PERFORM pg_temp.gc_assert(NOT piggyvest_primary.goal_cancel_needs_review(c_goal::uuid),
    'the legacy contribution was still counted after removal');
  -- An unreversed redemption needs review at issue (no new row is created); a
  -- reversed one does not.
  PERFORM pg_catalog.set_config('session_replication_role', 'replica', true);
  INSERT INTO public.customer_savings_redemptions
    (goal_id, merchant_id, customer_id, order_id, amount, idempotency_key)
  VALUES (c_goal::uuid, 'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003',
    'f3860000-0000-4000-8000-0000000000f5', 1, 'synthetic-goalcancel-redemption-old');
  PERFORM pg_catalog.set_config('session_replication_role', 'origin', true);
  PERFORM pg_temp.gc_assert(piggyvest_primary.goal_cancel_needs_review(c_goal::uuid),
    'an unreversed redemption did not need review');
  v_issue2 := pg_temp.gc_issue_op();
  PERFORM pg_temp.gc_assert(v_issue2 ->> 'status' = 'needs_review' AND v_issue2 ->> 'operationId' IS NULL,
    'issue for a goal with an unreversed redemption: ' || v_issue2::text);
  UPDATE public.customer_savings_redemptions
     SET metadata = metadata || '{"reversed_at": "2026-01-01T00:00:00Z"}'::jsonb
   WHERE idempotency_key = 'synthetic-goalcancel-redemption-old';
  PERFORM pg_temp.gc_assert(NOT piggyvest_primary.goal_cancel_needs_review(c_goal::uuid),
    'a reversed redemption still needed review');
  PERFORM pg_catalog.set_config('session_replication_role', 'replica', true);
  DELETE FROM public.customer_savings_redemptions WHERE idempotency_key = 'synthetic-goalcancel-redemption-old';
  PERFORM pg_catalog.set_config('session_replication_role', 'origin', true);
  v_issue2 := pg_temp.gc_issue_op();
  PERFORM pg_temp.gc_assert(v_issue2 ->> 'status' = 'issued' AND v_issue2 ->> 'operationId' = v_op,
    'a clean goal did not return its issued id again: ' || v_issue2::text);

  -- 2. No proof / garbage: refused; the issued id stays usable.
  v_result := pg_temp.gc_reserve(v_op, NULL);
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'pin_refused' AND v_result ->> 'reason' = 'missing',
    'missing proof: ' || v_result::text);
  v_result := pg_temp.gc_reserve(v_op, 'not-a-proof');
  PERFORM pg_temp.gc_assert(v_result ->> 'reason' = 'invalid', 'garbage proof: ' || v_result::text);
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'issued', 'a refusal changed the state');

  -- 3. An operation id this database never issued is never spent against,
  -- even with a proof bound to it.
  PERFORM pg_temp.gc_issue('invented', 'goal_cancel', 1, pg_temp.gc_key(c_invented));
  v_result := pg_temp.gc_reserve(c_invented, pg_temp.gc_token('invented'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'conflict', 'invented id: ' || v_result::text);
  PERFORM pg_temp.gc_assert(NOT pg_temp.gc_spent('invented'), 'a proof was spent for an invented id');

  -- 4. Wrong bindings are mismatches, rolled back and left unspent: the
  -- unbound goal:cancel key, another operation, another purpose, another amount.
  PERFORM pg_temp.gc_issue('unbound', 'goal_cancel', 1, c_goal || ':cancel');
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('unbound'));
  PERFORM pg_temp.gc_assert(v_result ->> 'reason' = 'mismatch', 'unbound key: ' || v_result::text);
  PERFORM pg_temp.gc_issue('other-op', 'goal_cancel', 1, pg_temp.gc_key(c_other));
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('other-op'));
  PERFORM pg_temp.gc_assert(v_result ->> 'reason' = 'mismatch', 'other operation: ' || v_result::text);
  PERFORM pg_temp.gc_issue('wrong-purpose', 'goal_fund', 1, pg_temp.gc_key(v_op));
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('wrong-purpose'));
  PERFORM pg_temp.gc_assert(v_result ->> 'reason' = 'mismatch', 'wrong purpose: ' || v_result::text);
  PERFORM pg_temp.gc_issue('wrong-amount', 'goal_cancel', 5000, pg_temp.gc_key(v_op));
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('wrong-amount'));
  PERFORM pg_temp.gc_assert(v_result ->> 'reason' = 'mismatch', 'wrong amount: ' || v_result::text);
  PERFORM pg_temp.gc_assert(NOT pg_temp.gc_spent('unbound') AND NOT pg_temp.gc_spent('wrong-amount'),
    'a mismatched proof was spent');
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'issued', 'a mismatch changed the state');

  -- 5. An expired proof is refused (one live proof per binding, so the unspent
  -- wrong-amount proof is removed first).
  DELETE FROM wallet_pin_private.proofs
   WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(pg_temp.gc_token('wrong-amount'), 'hex'));
  PERFORM pg_temp.gc_issue('expired', 'goal_cancel', 1, pg_temp.gc_key(v_op), 121);
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('expired'));
  PERFORM pg_temp.gc_assert(v_result ->> 'reason' = 'expired', 'expired proof: ' || v_result::text);

  -- 6. A malformed request is invalid, never defaulted.
  BEGIN
    PERFORM piggyvest_primary.reserve_goal_cancel_with_pin(v_scope,
      pg_catalog.jsonb_build_object('operationId', v_op), pg_temp.gc_token('unbound'));
    RAISE EXCEPTION 'request without a goal id was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM piggyvest_primary.reserve_goal_cancel_with_pin(v_scope, NULL, pg_temp.gc_token('unbound'));
    RAISE EXCEPTION 'null request was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- 7. The exact proof reserves the attempt and is spent with it.
  DELETE FROM wallet_pin_private.proofs
   WHERE token_sha256 IN (pg_catalog.sha256(pg_catalog.decode(pg_temp.gc_token('unbound'), 'hex')),
                          pg_catalog.sha256(pg_catalog.decode(pg_temp.gc_token('expired'), 'hex')));
  PERFORM pg_temp.gc_issue('exact', 'goal_cancel', 1, pg_temp.gc_key(v_op));
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('exact'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'claimed', 'exact proof: ' || v_result::text);
  PERFORM pg_temp.gc_assert(
    v_result #>> '{reservation,sourceWalletId}' = 'synthetic-goalcancel-goal-wallet'
    AND v_result #>> '{reservation,destinationWalletId}' = 'synthetic-goalcancel-main'
    AND v_result #>> '{reservation,reference}' = 'pvb-cancel-' || c_goal
    AND v_result #>> '{reservation,providerCustomerId}' = 'synthetic-goalcancel-customer',
    'reservation shape: ' || v_result::text);
  PERFORM pg_temp.gc_assert(pg_temp.gc_spent('exact') AND pg_temp.gc_state(v_op) = 'reserved',
    'the proof was not spent with the reservation');

  -- 8. A replay needs no new proof and spends none; a spent proof cannot be reused.
  v_result := pg_temp.gc_reserve(v_op, NULL);
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'pending', 'replay: ' || v_result::text);
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('exact'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'pending', 'replay with spent proof: ' || v_result::text);
  v_issue2 := pg_temp.gc_issue_op();
  PERFORM pg_temp.gc_assert(v_issue2 ->> 'status' = 'pending' AND v_issue2 ->> 'operationId' = v_op,
    'issue during a live attempt: ' || v_issue2::text);

  -- 9. Funding cannot be reserved for a goal with a cancel in flight.
  BEGIN
    INSERT INTO piggyvest_primary.savings_operations (
      id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
      destination_wallet_id, reference, state, wallet_transaction_id)
    VALUES ('f3860000-0000-4000-8000-0000000000f1', 'f3860000-0000-4000-8000-000000000006',
      'f3860000-0000-4000-8000-000000000007', c_goal::uuid, 100, 'synthetic-goalcancel-main',
      'synthetic-goalcancel-goal-wallet', 'pvb-save-f3860000-0000-4000-8000-0000000000f1', 'reserved',
      'f3860000-0000-4000-8000-000000000009');
    -- A custom SQLSTATE the handler below does not catch: if the insert
    -- succeeds the test fails here instead of passing by accident.
    RAISE EXCEPTION 'funding was reserved during a cancel' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gc_assert(SQLERRM = 'savings goal is being cancelled',
      'funding fence raised another error: ' || SQLERRM);
  END;

  -- 10. Dispatch records the provider balance as the amount, exactly once.
  BEGIN
    PERFORM piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'dispatch', NULL);
    RAISE EXCEPTION 'dispatch without an amount was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'dispatch', 0);
    RAISE EXCEPTION 'dispatch with a zero amount was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  PERFORM pg_temp.gc_assert(NOT piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'cancel_stale', NULL),
    'a fresh reservation was cancelled as stale');
  PERFORM pg_temp.gc_assert(piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'dispatch', 250000),
    'dispatch refused');
  PERFORM pg_temp.gc_assert(NOT piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'dispatch', 999),
    'a second dispatch was accepted');
  PERFORM pg_temp.gc_assert(
    (SELECT amount_kobo FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid) = 250000
    AND piggyvest_primary.read_goal_cancel_status(v_scope, v_op::uuid) = 'dispatched',
    'dispatch did not record the amount');
  PERFORM pg_temp.gc_assert(NOT piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'cancel', NULL),
    'a dispatched attempt was cancelled before dispatch');
  v_result := piggyvest_primary.read_dispatched_goal_cancel(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', v_op::uuid);
  PERFORM pg_temp.gc_assert(v_result ->> 'amountKobo' = '250000' AND v_result ->> 'businessId' = 'synthetic-goalcancel-business',
    'dispatched read: ' || COALESCE(v_result::text, 'null'));
  -- The webhook path resolves the dispatched attempt by its provider reference.
  v_result := piggyvest_primary.find_dispatched_goal_cancel_by_reference(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', 'pvb-cancel-' || c_goal);
  PERFORM pg_temp.gc_assert(v_result ->> 'operationId' = v_op, 'find by reference: ' || COALESCE(v_result::text, 'null'));
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.find_dispatched_goal_cancel_by_reference(
      'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', 'pvb-cancel-' || c_goal || '-9') IS NULL,
    'find by reference matched an unknown reference');
  -- A dispatched cancel blocks an order redemption of the goal (the trigger
  -- fires before the foreign keys, so a synthetic order id is enough).
  BEGIN
    INSERT INTO public.customer_savings_redemptions
      (goal_id, merchant_id, customer_id, order_id, amount, idempotency_key)
    VALUES (c_goal::uuid, 'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003',
      'f3860000-0000-4000-8000-0000000000f3', 1, 'synthetic-goalcancel-redemption');
    RAISE EXCEPTION 'a goal with a dispatched cancel was redeemed' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gc_assert(SQLERRM = 'savings_goal_cancel_in_progress',
      'redemption guard raised another error: ' || SQLERRM);
  END;
  -- Customer and goal deletion wait for the unresolved cancel.
  BEGIN
    DELETE FROM public.customer_savings_goals WHERE id = c_goal::uuid;
    RAISE EXCEPTION 'a goal with a dispatched cancel was deleted' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gc_assert(SQLERRM = 'cannot delete goal with unsettled goal cancellations',
      'goal deletion guard raised another error: ' || SQLERRM);
  END;
  -- The earlier bank-inbox guard refuses a customer whose provider wallet is
  -- still open before this guard runs, so the fixture's wallet is closed first.
  -- The close is undone with the failed delete when the handler below runs.
  BEGIN
    UPDATE piggyvest_primary.onboarding_intents SET provider_closed_at = pg_catalog.clock_timestamp()
     WHERE id = 'f3860000-0000-4000-8000-000000000007';
    DELETE FROM public.customers WHERE id = 'f3860000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'a customer with a dispatched cancel was deleted' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gc_assert(SQLERRM = 'cannot delete customer with unsettled goal cancellations',
      'customer deletion guard raised another error: ' || SQLERRM);
  END;

  -- 11. Settlement refuses any mismatch and a malformed proof.
  BEGIN
    PERFORM piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op) - 'businessId');
    RAISE EXCEPTION 'a proof with a missing key was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  FOREACH v_text IN ARRAY ARRAY['amountKobo', 'reference', 'sourceWalletId', 'destinationWalletId', 'businessId'] LOOP
    v_result := pg_catalog.to_jsonb(piggyvest_primary.settle_goal_cancel(
      'f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      CASE WHEN v_text = 'amountKobo' THEN pg_temp.gc_proof(v_op) || '{"amountKobo":250001}'::jsonb
           ELSE pg_temp.gc_proof(v_op) || pg_catalog.jsonb_build_object(v_text, 'tampered') END));
    PERFORM pg_temp.gc_assert(v_result #>> '{}' = 'conflict', 'tampered ' || v_text || ': ' || v_result::text);
  END LOOP;
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'dispatched'
    AND (SELECT status FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 'active',
    'a refused settlement changed state');

  -- 12. A failed provider record releases the attempt; a NEW attempt with a
  -- new PIN proof and a fresh reference can be tried.
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.release_failed_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op, 'failed')) = 'released', 'failed record did not release');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.release_failed_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op, 'failed')) = 'duplicate', 'a replayed release was not idempotent');
  -- The released attempt was dispatched, so reconciliation can still load it
  -- (read and by-reference lookup), which is what makes a late success reachable.
  v_result := piggyvest_primary.read_dispatched_goal_cancel(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', v_op::uuid);
  PERFORM pg_temp.gc_assert(v_result ->> 'operationId' = v_op AND v_result ->> 'amountKobo' = '250000',
    'a released-but-dispatched attempt was not loadable: ' || COALESCE(v_result::text, 'null'));
  v_result := piggyvest_primary.find_dispatched_goal_cancel_by_reference(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', 'pvb-cancel-' || c_goal);
  PERFORM pg_temp.gc_assert(v_result ->> 'operationId' = v_op,
    'a released-but-dispatched attempt was not found by reference');
  -- A transfer the provider indexed late and then completed settles the
  -- released (but dispatched) attempt. Probed in a block that is rolled back.
  BEGIN
    PERFORM pg_temp.gc_assert(
      piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
        pg_temp.gc_proof(v_op)) = 'confirmed', 'a late success on a released attempt was not settled');
    PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'confirmed'
      AND (SELECT status FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 'cancelled',
      'a late success did not cancel the goal');
    PERFORM pg_temp.gc_assert(
      (SELECT available_balance FROM public.customer_wallets
        WHERE id = 'f3860000-0000-4000-8000-000000000008') = 3500,
      'a late success did not credit the main wallet');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'released'
    AND (SELECT status FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 'active',
    'the late-success probe was not rolled back');
  PERFORM pg_temp.gc_assert(
    (SELECT available_balance FROM public.customer_wallets
      WHERE id = 'f3860000-0000-4000-8000-000000000008') = 1000,
    'the late-success probe left a wallet credit behind');
  -- Release, fund again, then a late success: the refund settles only its own
  -- amount (main wallet credited, local goal reduced by that amount), the goal
  -- KEEPS the newer contribution and stays open, a review marker is written and
  -- the answer is 'conflict' so the application pages an operator.
  BEGIN
    INSERT INTO piggyvest_primary.savings_operations (
      id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
      destination_wallet_id, reference, state, wallet_transaction_id)
    VALUES ('f3860000-0000-4000-8000-0000000000f3', 'f3860000-0000-4000-8000-000000000006',
      'f3860000-0000-4000-8000-000000000007', c_goal::uuid, 10000, 'synthetic-goalcancel-main',
      'synthetic-goalcancel-goal-wallet', 'pvb-save-f3860000-0000-4000-8000-0000000000f3', 'confirmed',
      'f3860000-0000-4000-8000-000000000009');
    UPDATE public.customer_savings_goals SET current_amount = current_amount + 100
     WHERE id = c_goal::uuid;
    PERFORM pg_temp.gc_assert(
      piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
        pg_temp.gc_proof(v_op)) = 'conflict', 'a late success after new funding was not routed to review');
    PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'confirmed'
      AND (SELECT status FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 'active'
      AND (SELECT current_amount FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 100,
      'a late success zeroed or closed a goal that was funded again');
    PERFORM pg_temp.gc_assert(
      (SELECT available_balance FROM public.customer_wallets
        WHERE id = 'f3860000-0000-4000-8000-000000000008') = 3500,
      'a late success after new funding did not credit exactly its own amount');
    PERFORM pg_temp.gc_assert(
      EXISTS (SELECT 1 FROM public.customer_savings_events
               WHERE goal_id = c_goal::uuid AND event_type = 'goal_cancel_needs_review')
      AND NOT EXISTS (SELECT 1 FROM public.customer_savings_events
               WHERE goal_id = c_goal::uuid AND event_type = 'goal_cancelled_refunded'),
      'a late success after new funding wrote no review marker');
    PERFORM pg_temp.gc_assert(
      piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
        pg_temp.gc_proof(v_op)) = 'duplicate', 'a replayed late success was not idempotent');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- A proof with the wrong reference never settles it.
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op) || pg_catalog.jsonb_build_object('reference', 'pvb-cancel-' || c_goal || '-1')) = 'conflict',
    'a released attempt settled on another reference');
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('exact'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'conflict', 'a released id was reusable: ' || v_result::text);
  v_issue := pg_temp.gc_issue_op();
  v_op2 := v_issue ->> 'operationId';
  PERFORM pg_temp.gc_assert(v_issue ->> 'status' = 'issued' AND v_op2 <> v_op, 'no fresh attempt after release');
  PERFORM pg_temp.gc_issue('second', 'goal_cancel', 1, pg_temp.gc_key(v_op2));
  v_result := pg_temp.gc_reserve(v_op2, pg_temp.gc_token('second'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'claimed', 'second attempt did not reserve');
  -- The released attempt was dispatched, so the retry takes a fresh reference.
  PERFORM pg_temp.gc_assert(v_result #>> '{reservation,reference}' = 'pvb-cancel-' || c_goal || '-1',
    'a retry after a failed transfer reused the reference: ' || v_result::text);

  -- 13. A stale reservation (nothing sent) can be released; an issued id past
  -- its expiry is dead; neither frees a proof.
  UPDATE piggyvest_primary.goal_cancel_operations SET reserved_at = pg_catalog.clock_timestamp() - interval '6 minutes'
   WHERE id = v_op2::uuid;
  PERFORM pg_temp.gc_assert(piggyvest_primary.manage_goal_cancel(v_scope, v_op2::uuid, 'cancel_stale', NULL),
    'a stale reservation was not released');
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op2) = 'released', 'stale release state');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.read_dispatched_goal_cancel(
      'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', v_op2::uuid) IS NULL,
    'a released attempt that was never dispatched was loadable');
  v_issue := pg_temp.gc_issue_op();
  v_op := v_issue ->> 'operationId';
  UPDATE piggyvest_primary.goal_cancel_operations SET expires_at = pg_catalog.clock_timestamp() - interval '1 second'
   WHERE id = v_op::uuid;
  PERFORM pg_temp.gc_issue('late', 'goal_cancel', 1, pg_temp.gc_key(v_op));
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('late'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'expired', 'expired id: ' || v_result::text);
  PERFORM pg_temp.gc_assert(NOT pg_temp.gc_spent('late') AND pg_temp.gc_state(v_op) = 'released',
    'an expired id spent a proof');

  -- 14. The final attempt settles: attempt confirmed, goal cancelled, event written.
  v_issue := pg_temp.gc_issue_op();
  v_op := v_issue ->> 'operationId';
  -- The goal wallet holds 250000 kobo of confirmed funding at the provider.
  INSERT INTO piggyvest_primary.savings_operations (
    id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
    destination_wallet_id, reference, state, wallet_transaction_id)
  VALUES ('f3860000-0000-4000-8000-0000000000f4', 'f3860000-0000-4000-8000-000000000006',
    'f3860000-0000-4000-8000-000000000007', c_goal::uuid, 250000, 'synthetic-goalcancel-main',
    'synthetic-goalcancel-goal-wallet', 'pvb-save-f3860000-0000-4000-8000-0000000000f4', 'confirmed',
    'f3860000-0000-4000-8000-000000000009');
  v_result := piggyvest_primary.read_daily_reconciliation(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', '{"staleAfterSeconds":60}'::jsonb);
  PERFORM pg_temp.gc_assert(v_result -> 'wallets' =
    '[{"walletId":"synthetic-goalcancel-goal-wallet","expectedKobo":250000}]'::jsonb,
    'funded goal expected balance wrong before the cancel: ' || (v_result -> 'wallets')::text);
  PERFORM pg_temp.gc_issue('final', 'goal_cancel', 1, pg_temp.gc_key(v_op));
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('final'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'claimed', 'final reserve');
  -- Attempts released without ever being dispatched do not advance the suffix.
  PERFORM pg_temp.gc_assert(v_result #>> '{reservation,reference}' = 'pvb-cancel-' || c_goal || '-1',
    'the reference suffix moved without a dispatched failure: ' || v_result::text);
  PERFORM pg_temp.gc_assert(piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'dispatch', 250000), 'final dispatch');
  -- A residual provider balance after the transfer (a credit landed between
  -- the snapshot and the transfer) is never settled as cancelled-at-zero: the
  -- refund is credited, the goal stays open with the residual recorded, a
  -- review marker is written and the answer is 'conflict'. Rolled back.
  -- Only a positive integer residual (and no other extra key) is a valid proof.
  FOREACH v_text IN ARRAY ARRAY['{"residualKobo":0}', '{"residualKobo":"4200"}', '{"other":"x"}'] LOOP
    BEGIN
      PERFORM piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
        pg_temp.gc_proof(v_op) || v_text::jsonb);
      RAISE EXCEPTION 'an invalid residual proof was accepted: %', v_text USING ERRCODE = 'PVT00';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM pg_temp.gc_assert(
      piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
        pg_temp.gc_proof(v_op) || '{"residualKobo":4200}'::jsonb) = 'conflict',
      'a residual provider balance was settled as cancelled-at-zero');
    PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'confirmed'
      AND (SELECT status FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 'active'
      AND (SELECT current_amount FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 42
      AND (SELECT available_balance FROM public.customer_wallets
            WHERE id = 'f3860000-0000-4000-8000-000000000008') = 3500
      AND EXISTS (SELECT 1 FROM public.customer_savings_events
                   WHERE goal_id = c_goal::uuid AND event_type = 'goal_cancel_needs_review'),
      'a residual balance did not keep the goal open for review');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op)) = 'confirmed', 'settlement refused');
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'confirmed'
    AND (SELECT status FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 'cancelled'
    AND (SELECT current_amount FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 0
    AND (SELECT cancelled_at IS NOT NULL FROM public.customer_savings_goals WHERE id = c_goal::uuid)
    AND EXISTS (SELECT 1 FROM public.customer_savings_events WHERE goal_id = c_goal::uuid AND event_type = 'goal_cancelled_refunded'),
    'settlement did not confirm the attempt and cancel the goal together');
  PERFORM pg_temp.gc_assert(
    (SELECT available_balance FROM public.customer_wallets
      WHERE id = 'f3860000-0000-4000-8000-000000000008') = 3500
    AND (SELECT pg_catalog.count(*) FROM public.customer_wallet_transactions
          WHERE source_type = 'piggyvest_goal_cancel' AND source_id = v_op::uuid
            AND type = 'refund' AND status = 'completed' AND amount = 2500 AND balance_after = 3500) = 1,
    'settlement did not credit the main-wallet ledger once');
  -- A confirmed refund lowers the expected provider balance: a fully
  -- cancelled goal expects 0, so a legitimate cancel never reads as a shortfall.
  v_result := piggyvest_primary.read_daily_reconciliation(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', '{"staleAfterSeconds":60}'::jsonb);
  PERFORM pg_temp.gc_assert(v_result -> 'wallets' =
    '[{"walletId":"synthetic-goalcancel-goal-wallet","expectedKobo":0}]'::jsonb,
    'a cancelled goal still expects its principal: ' || (v_result -> 'wallets')::text);
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op)) = 'duplicate', 'a replayed settlement was not idempotent');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op) || '{"providerTransactionId":"another-transaction"}'::jsonb) = 'conflict',
    'a different provider transaction settled a confirmed attempt');
  PERFORM pg_temp.gc_assert(
    (SELECT pg_catalog.count(*) FROM public.customer_savings_events WHERE goal_id = c_goal::uuid AND event_type = 'goal_cancelled_refunded') = 1,
    'a replay wrote a second event');
  PERFORM pg_temp.gc_assert(
    (SELECT available_balance FROM public.customer_wallets
      WHERE id = 'f3860000-0000-4000-8000-000000000008') = 3500
    AND (SELECT pg_catalog.count(*) FROM public.customer_wallet_transactions
          WHERE source_type = 'piggyvest_goal_cancel' AND source_id = v_op::uuid) = 1,
    'a replayed settlement credited the wallet again');

  -- 15. After a confirmed cancel: the same id reads confirmed, a new cancel
  -- is refused, and funding stays fenced off.
  PERFORM pg_temp.gc_assert(pg_temp.gc_reserve(v_op, NULL) ->> 'status' = 'confirmed', 'confirmed replay');
  BEGIN
    PERFORM pg_temp.gc_issue_op();
    RAISE EXCEPTION 'a cancelled goal issued a new cancel';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    INSERT INTO piggyvest_primary.savings_operations (
      id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
      destination_wallet_id, reference, state, wallet_transaction_id)
    VALUES ('f3860000-0000-4000-8000-0000000000f2', 'f3860000-0000-4000-8000-000000000006',
      'f3860000-0000-4000-8000-000000000007', c_goal::uuid, 100, 'synthetic-goalcancel-main',
      'synthetic-goalcancel-goal-wallet', 'pvb-save-f3860000-0000-4000-8000-0000000000f2', 'reserved',
      'f3860000-0000-4000-8000-000000000009');
    RAISE EXCEPTION 'funding was reserved after a cancel' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gc_assert(SQLERRM = 'savings goal is being cancelled',
      'funding fence raised another error after a cancel: ' || SQLERRM);
  END;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_ctx = PG_EXCEPTION_CONTEXT;
  v_line := COALESCE(pg_catalog.substring(v_ctx from 'inline_code_block line ([0-9]+)')::int, 9999);
  IF v_line = 1 THEN RAISE SQLSTATE 'P0001'; END IF;
  IF v_line = 2 THEN RAISE SQLSTATE 'P0002'; END IF;
  IF v_line = 3 THEN RAISE SQLSTATE 'P0003'; END IF;
  IF v_line = 4 THEN RAISE SQLSTATE 'P0004'; END IF;
  IF v_line = 5 THEN RAISE SQLSTATE 'P0005'; END IF;
  IF v_line = 6 THEN RAISE SQLSTATE 'P0006'; END IF;
  IF v_line = 7 THEN RAISE SQLSTATE 'P0007'; END IF;
  IF v_line = 8 THEN RAISE SQLSTATE 'P0008'; END IF;
  IF v_line = 9 THEN RAISE SQLSTATE 'P0009'; END IF;
  IF v_line = 10 THEN RAISE SQLSTATE 'P0010'; END IF;
  IF v_line = 11 THEN RAISE SQLSTATE 'P0011'; END IF;
  IF v_line = 12 THEN RAISE SQLSTATE 'P0012'; END IF;
  IF v_line = 13 THEN RAISE SQLSTATE 'P0013'; END IF;
  IF v_line = 14 THEN RAISE SQLSTATE 'P0014'; END IF;
  IF v_line = 15 THEN RAISE SQLSTATE 'P0015'; END IF;
  IF v_line = 16 THEN RAISE SQLSTATE 'P0016'; END IF;
  IF v_line = 17 THEN RAISE SQLSTATE 'P0017'; END IF;
  IF v_line = 18 THEN RAISE SQLSTATE 'P0018'; END IF;
  IF v_line = 19 THEN RAISE SQLSTATE 'P0019'; END IF;
  IF v_line = 20 THEN RAISE SQLSTATE 'P0020'; END IF;
  IF v_line = 21 THEN RAISE SQLSTATE 'P0021'; END IF;
  IF v_line = 22 THEN RAISE SQLSTATE 'P0022'; END IF;
  IF v_line = 23 THEN RAISE SQLSTATE 'P0023'; END IF;
  IF v_line = 24 THEN RAISE SQLSTATE 'P0024'; END IF;
  IF v_line = 25 THEN RAISE SQLSTATE 'P0025'; END IF;
  IF v_line = 26 THEN RAISE SQLSTATE 'P0026'; END IF;
  IF v_line = 27 THEN RAISE SQLSTATE 'P0027'; END IF;
  IF v_line = 28 THEN RAISE SQLSTATE 'P0028'; END IF;
  IF v_line = 29 THEN RAISE SQLSTATE 'P0029'; END IF;
  IF v_line = 30 THEN RAISE SQLSTATE 'P0030'; END IF;
  IF v_line = 31 THEN RAISE SQLSTATE 'P0031'; END IF;
  IF v_line = 32 THEN RAISE SQLSTATE 'P0032'; END IF;
  IF v_line = 33 THEN RAISE SQLSTATE 'P0033'; END IF;
  IF v_line = 34 THEN RAISE SQLSTATE 'P0034'; END IF;
  IF v_line = 35 THEN RAISE SQLSTATE 'P0035'; END IF;
  IF v_line = 36 THEN RAISE SQLSTATE 'P0036'; END IF;
  IF v_line = 37 THEN RAISE SQLSTATE 'P0037'; END IF;
  IF v_line = 38 THEN RAISE SQLSTATE 'P0038'; END IF;
  IF v_line = 39 THEN RAISE SQLSTATE 'P0039'; END IF;
  IF v_line = 40 THEN RAISE SQLSTATE 'P0040'; END IF;
  IF v_line = 41 THEN RAISE SQLSTATE 'P0041'; END IF;
  IF v_line = 42 THEN RAISE SQLSTATE 'P0042'; END IF;
  IF v_line = 43 THEN RAISE SQLSTATE 'P0043'; END IF;
  IF v_line = 44 THEN RAISE SQLSTATE 'P0044'; END IF;
  IF v_line = 45 THEN RAISE SQLSTATE 'P0045'; END IF;
  IF v_line = 46 THEN RAISE SQLSTATE 'P0046'; END IF;
  IF v_line = 47 THEN RAISE SQLSTATE 'P0047'; END IF;
  IF v_line = 48 THEN RAISE SQLSTATE 'P0048'; END IF;
  IF v_line = 49 THEN RAISE SQLSTATE 'P0049'; END IF;
  IF v_line = 50 THEN RAISE SQLSTATE 'P0050'; END IF;
  IF v_line = 51 THEN RAISE SQLSTATE 'P0051'; END IF;
  IF v_line = 52 THEN RAISE SQLSTATE 'P0052'; END IF;
  IF v_line = 53 THEN RAISE SQLSTATE 'P0053'; END IF;
  IF v_line = 54 THEN RAISE SQLSTATE 'P0054'; END IF;
  IF v_line = 55 THEN RAISE SQLSTATE 'P0055'; END IF;
  IF v_line = 56 THEN RAISE SQLSTATE 'P0056'; END IF;
  IF v_line = 57 THEN RAISE SQLSTATE 'P0057'; END IF;
  IF v_line = 58 THEN RAISE SQLSTATE 'P0058'; END IF;
  IF v_line = 59 THEN RAISE SQLSTATE 'P0059'; END IF;
  IF v_line = 60 THEN RAISE SQLSTATE 'P0060'; END IF;
  IF v_line = 61 THEN RAISE SQLSTATE 'P0061'; END IF;
  IF v_line = 62 THEN RAISE SQLSTATE 'P0062'; END IF;
  IF v_line = 63 THEN RAISE SQLSTATE 'P0063'; END IF;
  IF v_line = 64 THEN RAISE SQLSTATE 'P0064'; END IF;
  IF v_line = 65 THEN RAISE SQLSTATE 'P0065'; END IF;
  IF v_line = 66 THEN RAISE SQLSTATE 'P0066'; END IF;
  IF v_line = 67 THEN RAISE SQLSTATE 'P0067'; END IF;
  IF v_line = 68 THEN RAISE SQLSTATE 'P0068'; END IF;
  IF v_line = 69 THEN RAISE SQLSTATE 'P0069'; END IF;
  IF v_line = 70 THEN RAISE SQLSTATE 'P0070'; END IF;
  IF v_line = 71 THEN RAISE SQLSTATE 'P0071'; END IF;
  IF v_line = 72 THEN RAISE SQLSTATE 'P0072'; END IF;
  IF v_line = 73 THEN RAISE SQLSTATE 'P0073'; END IF;
  IF v_line = 74 THEN RAISE SQLSTATE 'P0074'; END IF;
  IF v_line = 75 THEN RAISE SQLSTATE 'P0075'; END IF;
  IF v_line = 76 THEN RAISE SQLSTATE 'P0076'; END IF;
  IF v_line = 77 THEN RAISE SQLSTATE 'P0077'; END IF;
  IF v_line = 78 THEN RAISE SQLSTATE 'P0078'; END IF;
  IF v_line = 79 THEN RAISE SQLSTATE 'P0079'; END IF;
  IF v_line = 80 THEN RAISE SQLSTATE 'P0080'; END IF;
  IF v_line = 81 THEN RAISE SQLSTATE 'P0081'; END IF;
  IF v_line = 82 THEN RAISE SQLSTATE 'P0082'; END IF;
  IF v_line = 83 THEN RAISE SQLSTATE 'P0083'; END IF;
  IF v_line = 84 THEN RAISE SQLSTATE 'P0084'; END IF;
  IF v_line = 85 THEN RAISE SQLSTATE 'P0085'; END IF;
  IF v_line = 86 THEN RAISE SQLSTATE 'P0086'; END IF;
  IF v_line = 87 THEN RAISE SQLSTATE 'P0087'; END IF;
  IF v_line = 88 THEN RAISE SQLSTATE 'P0088'; END IF;
  IF v_line = 89 THEN RAISE SQLSTATE 'P0089'; END IF;
  IF v_line = 90 THEN RAISE SQLSTATE 'P0090'; END IF;
  IF v_line = 91 THEN RAISE SQLSTATE 'P0091'; END IF;
  IF v_line = 92 THEN RAISE SQLSTATE 'P0092'; END IF;
  IF v_line = 93 THEN RAISE SQLSTATE 'P0093'; END IF;
  IF v_line = 94 THEN RAISE SQLSTATE 'P0094'; END IF;
  IF v_line = 95 THEN RAISE SQLSTATE 'P0095'; END IF;
  IF v_line = 96 THEN RAISE SQLSTATE 'P0096'; END IF;
  IF v_line = 97 THEN RAISE SQLSTATE 'P0097'; END IF;
  IF v_line = 98 THEN RAISE SQLSTATE 'P0098'; END IF;
  IF v_line = 99 THEN RAISE SQLSTATE 'P0099'; END IF;
  IF v_line = 100 THEN RAISE SQLSTATE 'P0100'; END IF;
  IF v_line = 101 THEN RAISE SQLSTATE 'P0101'; END IF;
  IF v_line = 102 THEN RAISE SQLSTATE 'P0102'; END IF;
  IF v_line = 103 THEN RAISE SQLSTATE 'P0103'; END IF;
  IF v_line = 104 THEN RAISE SQLSTATE 'P0104'; END IF;
  IF v_line = 105 THEN RAISE SQLSTATE 'P0105'; END IF;
  IF v_line = 106 THEN RAISE SQLSTATE 'P0106'; END IF;
  IF v_line = 107 THEN RAISE SQLSTATE 'P0107'; END IF;
  IF v_line = 108 THEN RAISE SQLSTATE 'P0108'; END IF;
  IF v_line = 109 THEN RAISE SQLSTATE 'P0109'; END IF;
  IF v_line = 110 THEN RAISE SQLSTATE 'P0110'; END IF;
  IF v_line = 111 THEN RAISE SQLSTATE 'P0111'; END IF;
  IF v_line = 112 THEN RAISE SQLSTATE 'P0112'; END IF;
  IF v_line = 113 THEN RAISE SQLSTATE 'P0113'; END IF;
  IF v_line = 114 THEN RAISE SQLSTATE 'P0114'; END IF;
  IF v_line = 115 THEN RAISE SQLSTATE 'P0115'; END IF;
  IF v_line = 116 THEN RAISE SQLSTATE 'P0116'; END IF;
  IF v_line = 117 THEN RAISE SQLSTATE 'P0117'; END IF;
  IF v_line = 118 THEN RAISE SQLSTATE 'P0118'; END IF;
  IF v_line = 119 THEN RAISE SQLSTATE 'P0119'; END IF;
  IF v_line = 120 THEN RAISE SQLSTATE 'P0120'; END IF;
  IF v_line = 121 THEN RAISE SQLSTATE 'P0121'; END IF;
  IF v_line = 122 THEN RAISE SQLSTATE 'P0122'; END IF;
  IF v_line = 123 THEN RAISE SQLSTATE 'P0123'; END IF;
  IF v_line = 124 THEN RAISE SQLSTATE 'P0124'; END IF;
  IF v_line = 125 THEN RAISE SQLSTATE 'P0125'; END IF;
  IF v_line = 126 THEN RAISE SQLSTATE 'P0126'; END IF;
  IF v_line = 127 THEN RAISE SQLSTATE 'P0127'; END IF;
  IF v_line = 128 THEN RAISE SQLSTATE 'P0128'; END IF;
  IF v_line = 129 THEN RAISE SQLSTATE 'P0129'; END IF;
  IF v_line = 130 THEN RAISE SQLSTATE 'P0130'; END IF;
  IF v_line = 131 THEN RAISE SQLSTATE 'P0131'; END IF;
  IF v_line = 132 THEN RAISE SQLSTATE 'P0132'; END IF;
  IF v_line = 133 THEN RAISE SQLSTATE 'P0133'; END IF;
  IF v_line = 134 THEN RAISE SQLSTATE 'P0134'; END IF;
  IF v_line = 135 THEN RAISE SQLSTATE 'P0135'; END IF;
  IF v_line = 136 THEN RAISE SQLSTATE 'P0136'; END IF;
  IF v_line = 137 THEN RAISE SQLSTATE 'P0137'; END IF;
  IF v_line = 138 THEN RAISE SQLSTATE 'P0138'; END IF;
  IF v_line = 139 THEN RAISE SQLSTATE 'P0139'; END IF;
  IF v_line = 140 THEN RAISE SQLSTATE 'P0140'; END IF;
  IF v_line = 141 THEN RAISE SQLSTATE 'P0141'; END IF;
  IF v_line = 142 THEN RAISE SQLSTATE 'P0142'; END IF;
  IF v_line = 143 THEN RAISE SQLSTATE 'P0143'; END IF;
  IF v_line = 144 THEN RAISE SQLSTATE 'P0144'; END IF;
  IF v_line = 145 THEN RAISE SQLSTATE 'P0145'; END IF;
  IF v_line = 146 THEN RAISE SQLSTATE 'P0146'; END IF;
  IF v_line = 147 THEN RAISE SQLSTATE 'P0147'; END IF;
  IF v_line = 148 THEN RAISE SQLSTATE 'P0148'; END IF;
  IF v_line = 149 THEN RAISE SQLSTATE 'P0149'; END IF;
  IF v_line = 150 THEN RAISE SQLSTATE 'P0150'; END IF;
  IF v_line = 151 THEN RAISE SQLSTATE 'P0151'; END IF;
  IF v_line = 152 THEN RAISE SQLSTATE 'P0152'; END IF;
  IF v_line = 153 THEN RAISE SQLSTATE 'P0153'; END IF;
  IF v_line = 154 THEN RAISE SQLSTATE 'P0154'; END IF;
  IF v_line = 155 THEN RAISE SQLSTATE 'P0155'; END IF;
  IF v_line = 156 THEN RAISE SQLSTATE 'P0156'; END IF;
  IF v_line = 157 THEN RAISE SQLSTATE 'P0157'; END IF;
  IF v_line = 158 THEN RAISE SQLSTATE 'P0158'; END IF;
  IF v_line = 159 THEN RAISE SQLSTATE 'P0159'; END IF;
  IF v_line = 160 THEN RAISE SQLSTATE 'P0160'; END IF;
  IF v_line = 161 THEN RAISE SQLSTATE 'P0161'; END IF;
  IF v_line = 162 THEN RAISE SQLSTATE 'P0162'; END IF;
  IF v_line = 163 THEN RAISE SQLSTATE 'P0163'; END IF;
  IF v_line = 164 THEN RAISE SQLSTATE 'P0164'; END IF;
  IF v_line = 165 THEN RAISE SQLSTATE 'P0165'; END IF;
  IF v_line = 166 THEN RAISE SQLSTATE 'P0166'; END IF;
  IF v_line = 167 THEN RAISE SQLSTATE 'P0167'; END IF;
  IF v_line = 168 THEN RAISE SQLSTATE 'P0168'; END IF;
  IF v_line = 169 THEN RAISE SQLSTATE 'P0169'; END IF;
  IF v_line = 170 THEN RAISE SQLSTATE 'P0170'; END IF;
  IF v_line = 171 THEN RAISE SQLSTATE 'P0171'; END IF;
  IF v_line = 172 THEN RAISE SQLSTATE 'P0172'; END IF;
  IF v_line = 173 THEN RAISE SQLSTATE 'P0173'; END IF;
  IF v_line = 174 THEN RAISE SQLSTATE 'P0174'; END IF;
  IF v_line = 175 THEN RAISE SQLSTATE 'P0175'; END IF;
  IF v_line = 176 THEN RAISE SQLSTATE 'P0176'; END IF;
  IF v_line = 177 THEN RAISE SQLSTATE 'P0177'; END IF;
  IF v_line = 178 THEN RAISE SQLSTATE 'P0178'; END IF;
  IF v_line = 179 THEN RAISE SQLSTATE 'P0179'; END IF;
  IF v_line = 180 THEN RAISE SQLSTATE 'P0180'; END IF;
  IF v_line = 181 THEN RAISE SQLSTATE 'P0181'; END IF;
  IF v_line = 182 THEN RAISE SQLSTATE 'P0182'; END IF;
  IF v_line = 183 THEN RAISE SQLSTATE 'P0183'; END IF;
  IF v_line = 184 THEN RAISE SQLSTATE 'P0184'; END IF;
  IF v_line = 185 THEN RAISE SQLSTATE 'P0185'; END IF;
  IF v_line = 186 THEN RAISE SQLSTATE 'P0186'; END IF;
  IF v_line = 187 THEN RAISE SQLSTATE 'P0187'; END IF;
  IF v_line = 188 THEN RAISE SQLSTATE 'P0188'; END IF;
  IF v_line = 189 THEN RAISE SQLSTATE 'P0189'; END IF;
  IF v_line = 190 THEN RAISE SQLSTATE 'P0190'; END IF;
  IF v_line = 191 THEN RAISE SQLSTATE 'P0191'; END IF;
  IF v_line = 192 THEN RAISE SQLSTATE 'P0192'; END IF;
  IF v_line = 193 THEN RAISE SQLSTATE 'P0193'; END IF;
  IF v_line = 194 THEN RAISE SQLSTATE 'P0194'; END IF;
  IF v_line = 195 THEN RAISE SQLSTATE 'P0195'; END IF;
  IF v_line = 196 THEN RAISE SQLSTATE 'P0196'; END IF;
  IF v_line = 197 THEN RAISE SQLSTATE 'P0197'; END IF;
  IF v_line = 198 THEN RAISE SQLSTATE 'P0198'; END IF;
  IF v_line = 199 THEN RAISE SQLSTATE 'P0199'; END IF;
  IF v_line = 200 THEN RAISE SQLSTATE 'P0200'; END IF;
  IF v_line = 201 THEN RAISE SQLSTATE 'P0201'; END IF;
  IF v_line = 202 THEN RAISE SQLSTATE 'P0202'; END IF;
  IF v_line = 203 THEN RAISE SQLSTATE 'P0203'; END IF;
  IF v_line = 204 THEN RAISE SQLSTATE 'P0204'; END IF;
  IF v_line = 205 THEN RAISE SQLSTATE 'P0205'; END IF;
  IF v_line = 206 THEN RAISE SQLSTATE 'P0206'; END IF;
  IF v_line = 207 THEN RAISE SQLSTATE 'P0207'; END IF;
  IF v_line = 208 THEN RAISE SQLSTATE 'P0208'; END IF;
  IF v_line = 209 THEN RAISE SQLSTATE 'P0209'; END IF;
  IF v_line = 210 THEN RAISE SQLSTATE 'P0210'; END IF;
  IF v_line = 211 THEN RAISE SQLSTATE 'P0211'; END IF;
  IF v_line = 212 THEN RAISE SQLSTATE 'P0212'; END IF;
  IF v_line = 213 THEN RAISE SQLSTATE 'P0213'; END IF;
  IF v_line = 214 THEN RAISE SQLSTATE 'P0214'; END IF;
  IF v_line = 215 THEN RAISE SQLSTATE 'P0215'; END IF;
  IF v_line = 216 THEN RAISE SQLSTATE 'P0216'; END IF;
  IF v_line = 217 THEN RAISE SQLSTATE 'P0217'; END IF;
  IF v_line = 218 THEN RAISE SQLSTATE 'P0218'; END IF;
  IF v_line = 219 THEN RAISE SQLSTATE 'P0219'; END IF;
  IF v_line = 220 THEN RAISE SQLSTATE 'P0220'; END IF;
  IF v_line = 221 THEN RAISE SQLSTATE 'P0221'; END IF;
  IF v_line = 222 THEN RAISE SQLSTATE 'P0222'; END IF;
  IF v_line = 223 THEN RAISE SQLSTATE 'P0223'; END IF;
  IF v_line = 224 THEN RAISE SQLSTATE 'P0224'; END IF;
  IF v_line = 225 THEN RAISE SQLSTATE 'P0225'; END IF;
  IF v_line = 226 THEN RAISE SQLSTATE 'P0226'; END IF;
  IF v_line = 227 THEN RAISE SQLSTATE 'P0227'; END IF;
  IF v_line = 228 THEN RAISE SQLSTATE 'P0228'; END IF;
  IF v_line = 229 THEN RAISE SQLSTATE 'P0229'; END IF;
  IF v_line = 230 THEN RAISE SQLSTATE 'P0230'; END IF;
  IF v_line = 231 THEN RAISE SQLSTATE 'P0231'; END IF;
  IF v_line = 232 THEN RAISE SQLSTATE 'P0232'; END IF;
  IF v_line = 233 THEN RAISE SQLSTATE 'P0233'; END IF;
  IF v_line = 234 THEN RAISE SQLSTATE 'P0234'; END IF;
  IF v_line = 235 THEN RAISE SQLSTATE 'P0235'; END IF;
  IF v_line = 236 THEN RAISE SQLSTATE 'P0236'; END IF;
  IF v_line = 237 THEN RAISE SQLSTATE 'P0237'; END IF;
  IF v_line = 238 THEN RAISE SQLSTATE 'P0238'; END IF;
  IF v_line = 239 THEN RAISE SQLSTATE 'P0239'; END IF;
  IF v_line = 240 THEN RAISE SQLSTATE 'P0240'; END IF;
  IF v_line = 241 THEN RAISE SQLSTATE 'P0241'; END IF;
  IF v_line = 242 THEN RAISE SQLSTATE 'P0242'; END IF;
  IF v_line = 243 THEN RAISE SQLSTATE 'P0243'; END IF;
  IF v_line = 244 THEN RAISE SQLSTATE 'P0244'; END IF;
  IF v_line = 245 THEN RAISE SQLSTATE 'P0245'; END IF;
  IF v_line = 246 THEN RAISE SQLSTATE 'P0246'; END IF;
  IF v_line = 247 THEN RAISE SQLSTATE 'P0247'; END IF;
  IF v_line = 248 THEN RAISE SQLSTATE 'P0248'; END IF;
  IF v_line = 249 THEN RAISE SQLSTATE 'P0249'; END IF;
  IF v_line = 250 THEN RAISE SQLSTATE 'P0250'; END IF;
  IF v_line = 251 THEN RAISE SQLSTATE 'P0251'; END IF;
  IF v_line = 252 THEN RAISE SQLSTATE 'P0252'; END IF;
  IF v_line = 253 THEN RAISE SQLSTATE 'P0253'; END IF;
  IF v_line = 254 THEN RAISE SQLSTATE 'P0254'; END IF;
  IF v_line = 255 THEN RAISE SQLSTATE 'P0255'; END IF;
  IF v_line = 256 THEN RAISE SQLSTATE 'P0256'; END IF;
  IF v_line = 257 THEN RAISE SQLSTATE 'P0257'; END IF;
  IF v_line = 258 THEN RAISE SQLSTATE 'P0258'; END IF;
  IF v_line = 259 THEN RAISE SQLSTATE 'P0259'; END IF;
  IF v_line = 260 THEN RAISE SQLSTATE 'P0260'; END IF;
  IF v_line = 261 THEN RAISE SQLSTATE 'P0261'; END IF;
  IF v_line = 262 THEN RAISE SQLSTATE 'P0262'; END IF;
  IF v_line = 263 THEN RAISE SQLSTATE 'P0263'; END IF;
  IF v_line = 264 THEN RAISE SQLSTATE 'P0264'; END IF;
  IF v_line = 265 THEN RAISE SQLSTATE 'P0265'; END IF;
  IF v_line = 266 THEN RAISE SQLSTATE 'P0266'; END IF;
  IF v_line = 267 THEN RAISE SQLSTATE 'P0267'; END IF;
  IF v_line = 268 THEN RAISE SQLSTATE 'P0268'; END IF;
  IF v_line = 269 THEN RAISE SQLSTATE 'P0269'; END IF;
  IF v_line = 270 THEN RAISE SQLSTATE 'P0270'; END IF;
  IF v_line = 271 THEN RAISE SQLSTATE 'P0271'; END IF;
  IF v_line = 272 THEN RAISE SQLSTATE 'P0272'; END IF;
  IF v_line = 273 THEN RAISE SQLSTATE 'P0273'; END IF;
  IF v_line = 274 THEN RAISE SQLSTATE 'P0274'; END IF;
  IF v_line = 275 THEN RAISE SQLSTATE 'P0275'; END IF;
  IF v_line = 276 THEN RAISE SQLSTATE 'P0276'; END IF;
  IF v_line = 277 THEN RAISE SQLSTATE 'P0277'; END IF;
  IF v_line = 278 THEN RAISE SQLSTATE 'P0278'; END IF;
  IF v_line = 279 THEN RAISE SQLSTATE 'P0279'; END IF;
  IF v_line = 280 THEN RAISE SQLSTATE 'P0280'; END IF;
  IF v_line = 281 THEN RAISE SQLSTATE 'P0281'; END IF;
  IF v_line = 282 THEN RAISE SQLSTATE 'P0282'; END IF;
  IF v_line = 283 THEN RAISE SQLSTATE 'P0283'; END IF;
  IF v_line = 284 THEN RAISE SQLSTATE 'P0284'; END IF;
  IF v_line = 285 THEN RAISE SQLSTATE 'P0285'; END IF;
  IF v_line = 286 THEN RAISE SQLSTATE 'P0286'; END IF;
  IF v_line = 287 THEN RAISE SQLSTATE 'P0287'; END IF;
  IF v_line = 288 THEN RAISE SQLSTATE 'P0288'; END IF;
  IF v_line = 289 THEN RAISE SQLSTATE 'P0289'; END IF;
  IF v_line = 290 THEN RAISE SQLSTATE 'P0290'; END IF;
  IF v_line = 291 THEN RAISE SQLSTATE 'P0291'; END IF;
  IF v_line = 292 THEN RAISE SQLSTATE 'P0292'; END IF;
  IF v_line = 293 THEN RAISE SQLSTATE 'P0293'; END IF;
  IF v_line = 294 THEN RAISE SQLSTATE 'P0294'; END IF;
  IF v_line = 295 THEN RAISE SQLSTATE 'P0295'; END IF;
  IF v_line = 296 THEN RAISE SQLSTATE 'P0296'; END IF;
  IF v_line = 297 THEN RAISE SQLSTATE 'P0297'; END IF;
  IF v_line = 298 THEN RAISE SQLSTATE 'P0298'; END IF;
  IF v_line = 299 THEN RAISE SQLSTATE 'P0299'; END IF;
  IF v_line = 300 THEN RAISE SQLSTATE 'P0300'; END IF;
  IF v_line = 301 THEN RAISE SQLSTATE 'P0301'; END IF;
  IF v_line = 302 THEN RAISE SQLSTATE 'P0302'; END IF;
  IF v_line = 303 THEN RAISE SQLSTATE 'P0303'; END IF;
  IF v_line = 304 THEN RAISE SQLSTATE 'P0304'; END IF;
  IF v_line = 305 THEN RAISE SQLSTATE 'P0305'; END IF;
  IF v_line = 306 THEN RAISE SQLSTATE 'P0306'; END IF;
  IF v_line = 307 THEN RAISE SQLSTATE 'P0307'; END IF;
  IF v_line = 308 THEN RAISE SQLSTATE 'P0308'; END IF;
  IF v_line = 309 THEN RAISE SQLSTATE 'P0309'; END IF;
  IF v_line = 310 THEN RAISE SQLSTATE 'P0310'; END IF;
  IF v_line = 311 THEN RAISE SQLSTATE 'P0311'; END IF;
  IF v_line = 312 THEN RAISE SQLSTATE 'P0312'; END IF;
  IF v_line = 313 THEN RAISE SQLSTATE 'P0313'; END IF;
  IF v_line = 314 THEN RAISE SQLSTATE 'P0314'; END IF;
  IF v_line = 315 THEN RAISE SQLSTATE 'P0315'; END IF;
  IF v_line = 316 THEN RAISE SQLSTATE 'P0316'; END IF;
  IF v_line = 317 THEN RAISE SQLSTATE 'P0317'; END IF;
  IF v_line = 318 THEN RAISE SQLSTATE 'P0318'; END IF;
  IF v_line = 319 THEN RAISE SQLSTATE 'P0319'; END IF;
  IF v_line = 320 THEN RAISE SQLSTATE 'P0320'; END IF;
  IF v_line = 321 THEN RAISE SQLSTATE 'P0321'; END IF;
  IF v_line = 322 THEN RAISE SQLSTATE 'P0322'; END IF;
  IF v_line = 323 THEN RAISE SQLSTATE 'P0323'; END IF;
  IF v_line = 324 THEN RAISE SQLSTATE 'P0324'; END IF;
  IF v_line = 325 THEN RAISE SQLSTATE 'P0325'; END IF;
  IF v_line = 326 THEN RAISE SQLSTATE 'P0326'; END IF;
  IF v_line = 327 THEN RAISE SQLSTATE 'P0327'; END IF;
  IF v_line = 328 THEN RAISE SQLSTATE 'P0328'; END IF;
  IF v_line = 329 THEN RAISE SQLSTATE 'P0329'; END IF;
  IF v_line = 330 THEN RAISE SQLSTATE 'P0330'; END IF;
  IF v_line = 331 THEN RAISE SQLSTATE 'P0331'; END IF;
  IF v_line = 332 THEN RAISE SQLSTATE 'P0332'; END IF;
  IF v_line = 333 THEN RAISE SQLSTATE 'P0333'; END IF;
  IF v_line = 334 THEN RAISE SQLSTATE 'P0334'; END IF;
  IF v_line = 335 THEN RAISE SQLSTATE 'P0335'; END IF;
  IF v_line = 336 THEN RAISE SQLSTATE 'P0336'; END IF;
  IF v_line = 337 THEN RAISE SQLSTATE 'P0337'; END IF;
  IF v_line = 338 THEN RAISE SQLSTATE 'P0338'; END IF;
  IF v_line = 339 THEN RAISE SQLSTATE 'P0339'; END IF;
  IF v_line = 340 THEN RAISE SQLSTATE 'P0340'; END IF;
  IF v_line = 341 THEN RAISE SQLSTATE 'P0341'; END IF;
  IF v_line = 342 THEN RAISE SQLSTATE 'P0342'; END IF;
  IF v_line = 343 THEN RAISE SQLSTATE 'P0343'; END IF;
  IF v_line = 344 THEN RAISE SQLSTATE 'P0344'; END IF;
  IF v_line = 345 THEN RAISE SQLSTATE 'P0345'; END IF;
  IF v_line = 346 THEN RAISE SQLSTATE 'P0346'; END IF;
  IF v_line = 347 THEN RAISE SQLSTATE 'P0347'; END IF;
  IF v_line = 348 THEN RAISE SQLSTATE 'P0348'; END IF;
  IF v_line = 349 THEN RAISE SQLSTATE 'P0349'; END IF;
  IF v_line = 350 THEN RAISE SQLSTATE 'P0350'; END IF;
  IF v_line = 351 THEN RAISE SQLSTATE 'P0351'; END IF;
  IF v_line = 352 THEN RAISE SQLSTATE 'P0352'; END IF;
  IF v_line = 353 THEN RAISE SQLSTATE 'P0353'; END IF;
  IF v_line = 354 THEN RAISE SQLSTATE 'P0354'; END IF;
  IF v_line = 355 THEN RAISE SQLSTATE 'P0355'; END IF;
  IF v_line = 356 THEN RAISE SQLSTATE 'P0356'; END IF;
  IF v_line = 357 THEN RAISE SQLSTATE 'P0357'; END IF;
  IF v_line = 358 THEN RAISE SQLSTATE 'P0358'; END IF;
  IF v_line = 359 THEN RAISE SQLSTATE 'P0359'; END IF;
  IF v_line = 360 THEN RAISE SQLSTATE 'P0360'; END IF;
  IF v_line = 361 THEN RAISE SQLSTATE 'P0361'; END IF;
  IF v_line = 362 THEN RAISE SQLSTATE 'P0362'; END IF;
  IF v_line = 363 THEN RAISE SQLSTATE 'P0363'; END IF;
  IF v_line = 364 THEN RAISE SQLSTATE 'P0364'; END IF;
  IF v_line = 365 THEN RAISE SQLSTATE 'P0365'; END IF;
  IF v_line = 366 THEN RAISE SQLSTATE 'P0366'; END IF;
  IF v_line = 367 THEN RAISE SQLSTATE 'P0367'; END IF;
  IF v_line = 368 THEN RAISE SQLSTATE 'P0368'; END IF;
  IF v_line = 369 THEN RAISE SQLSTATE 'P0369'; END IF;
  IF v_line = 370 THEN RAISE SQLSTATE 'P0370'; END IF;
  IF v_line = 371 THEN RAISE SQLSTATE 'P0371'; END IF;
  IF v_line = 372 THEN RAISE SQLSTATE 'P0372'; END IF;
  IF v_line = 373 THEN RAISE SQLSTATE 'P0373'; END IF;
  IF v_line = 374 THEN RAISE SQLSTATE 'P0374'; END IF;
  IF v_line = 375 THEN RAISE SQLSTATE 'P0375'; END IF;
  IF v_line = 376 THEN RAISE SQLSTATE 'P0376'; END IF;
  IF v_line = 377 THEN RAISE SQLSTATE 'P0377'; END IF;
  IF v_line = 378 THEN RAISE SQLSTATE 'P0378'; END IF;
  IF v_line = 379 THEN RAISE SQLSTATE 'P0379'; END IF;
  IF v_line = 380 THEN RAISE SQLSTATE 'P0380'; END IF;
  IF v_line = 381 THEN RAISE SQLSTATE 'P0381'; END IF;
  IF v_line = 382 THEN RAISE SQLSTATE 'P0382'; END IF;
  IF v_line = 383 THEN RAISE SQLSTATE 'P0383'; END IF;
  IF v_line = 384 THEN RAISE SQLSTATE 'P0384'; END IF;
  IF v_line = 385 THEN RAISE SQLSTATE 'P0385'; END IF;
  IF v_line = 386 THEN RAISE SQLSTATE 'P0386'; END IF;
  IF v_line = 387 THEN RAISE SQLSTATE 'P0387'; END IF;
  IF v_line = 388 THEN RAISE SQLSTATE 'P0388'; END IF;
  IF v_line = 389 THEN RAISE SQLSTATE 'P0389'; END IF;
  IF v_line = 390 THEN RAISE SQLSTATE 'P0390'; END IF;
  IF v_line = 391 THEN RAISE SQLSTATE 'P0391'; END IF;
  IF v_line = 392 THEN RAISE SQLSTATE 'P0392'; END IF;
  IF v_line = 393 THEN RAISE SQLSTATE 'P0393'; END IF;
  IF v_line = 394 THEN RAISE SQLSTATE 'P0394'; END IF;
  IF v_line = 395 THEN RAISE SQLSTATE 'P0395'; END IF;
  IF v_line = 396 THEN RAISE SQLSTATE 'P0396'; END IF;
  IF v_line = 397 THEN RAISE SQLSTATE 'P0397'; END IF;
  IF v_line = 398 THEN RAISE SQLSTATE 'P0398'; END IF;
  IF v_line = 399 THEN RAISE SQLSTATE 'P0399'; END IF;
  IF v_line = 400 THEN RAISE SQLSTATE 'P0400'; END IF;
  IF v_line = 401 THEN RAISE SQLSTATE 'P0401'; END IF;
  IF v_line = 402 THEN RAISE SQLSTATE 'P0402'; END IF;
  IF v_line = 403 THEN RAISE SQLSTATE 'P0403'; END IF;
  IF v_line = 404 THEN RAISE SQLSTATE 'P0404'; END IF;
  IF v_line = 405 THEN RAISE SQLSTATE 'P0405'; END IF;
  IF v_line = 406 THEN RAISE SQLSTATE 'P0406'; END IF;
  IF v_line = 407 THEN RAISE SQLSTATE 'P0407'; END IF;
  IF v_line = 408 THEN RAISE SQLSTATE 'P0408'; END IF;
  IF v_line = 409 THEN RAISE SQLSTATE 'P0409'; END IF;
  IF v_line = 410 THEN RAISE SQLSTATE 'P0410'; END IF;
  IF v_line = 411 THEN RAISE SQLSTATE 'P0411'; END IF;
  IF v_line = 412 THEN RAISE SQLSTATE 'P0412'; END IF;
  IF v_line = 413 THEN RAISE SQLSTATE 'P0413'; END IF;
  IF v_line = 414 THEN RAISE SQLSTATE 'P0414'; END IF;
  IF v_line = 415 THEN RAISE SQLSTATE 'P0415'; END IF;
  IF v_line = 416 THEN RAISE SQLSTATE 'P0416'; END IF;
  IF v_line = 417 THEN RAISE SQLSTATE 'P0417'; END IF;
  IF v_line = 418 THEN RAISE SQLSTATE 'P0418'; END IF;
  IF v_line = 419 THEN RAISE SQLSTATE 'P0419'; END IF;
  IF v_line = 420 THEN RAISE SQLSTATE 'P0420'; END IF;
  IF v_line = 421 THEN RAISE SQLSTATE 'P0421'; END IF;
  IF v_line = 422 THEN RAISE SQLSTATE 'P0422'; END IF;
  IF v_line = 423 THEN RAISE SQLSTATE 'P0423'; END IF;
  IF v_line = 424 THEN RAISE SQLSTATE 'P0424'; END IF;
  IF v_line = 425 THEN RAISE SQLSTATE 'P0425'; END IF;
  IF v_line = 426 THEN RAISE SQLSTATE 'P0426'; END IF;
  IF v_line = 427 THEN RAISE SQLSTATE 'P0427'; END IF;
  IF v_line = 428 THEN RAISE SQLSTATE 'P0428'; END IF;
  IF v_line = 429 THEN RAISE SQLSTATE 'P0429'; END IF;
  IF v_line = 430 THEN RAISE SQLSTATE 'P0430'; END IF;
  IF v_line = 431 THEN RAISE SQLSTATE 'P0431'; END IF;
  IF v_line = 432 THEN RAISE SQLSTATE 'P0432'; END IF;
  IF v_line = 433 THEN RAISE SQLSTATE 'P0433'; END IF;
  IF v_line = 434 THEN RAISE SQLSTATE 'P0434'; END IF;
  IF v_line = 435 THEN RAISE SQLSTATE 'P0435'; END IF;
  IF v_line = 436 THEN RAISE SQLSTATE 'P0436'; END IF;
  IF v_line = 437 THEN RAISE SQLSTATE 'P0437'; END IF;
  IF v_line = 438 THEN RAISE SQLSTATE 'P0438'; END IF;
  IF v_line = 439 THEN RAISE SQLSTATE 'P0439'; END IF;
  IF v_line = 440 THEN RAISE SQLSTATE 'P0440'; END IF;
  IF v_line = 441 THEN RAISE SQLSTATE 'P0441'; END IF;
  IF v_line = 442 THEN RAISE SQLSTATE 'P0442'; END IF;
  IF v_line = 443 THEN RAISE SQLSTATE 'P0443'; END IF;
  IF v_line = 444 THEN RAISE SQLSTATE 'P0444'; END IF;
  IF v_line = 445 THEN RAISE SQLSTATE 'P0445'; END IF;
  IF v_line = 446 THEN RAISE SQLSTATE 'P0446'; END IF;
  IF v_line = 447 THEN RAISE SQLSTATE 'P0447'; END IF;
  IF v_line = 448 THEN RAISE SQLSTATE 'P0448'; END IF;
  IF v_line = 449 THEN RAISE SQLSTATE 'P0449'; END IF;
  IF v_line = 450 THEN RAISE SQLSTATE 'P0450'; END IF;
  IF v_line = 451 THEN RAISE SQLSTATE 'P0451'; END IF;
  IF v_line = 452 THEN RAISE SQLSTATE 'P0452'; END IF;
  IF v_line = 453 THEN RAISE SQLSTATE 'P0453'; END IF;
  IF v_line = 454 THEN RAISE SQLSTATE 'P0454'; END IF;
  IF v_line = 455 THEN RAISE SQLSTATE 'P0455'; END IF;
  IF v_line = 456 THEN RAISE SQLSTATE 'P0456'; END IF;
  IF v_line = 457 THEN RAISE SQLSTATE 'P0457'; END IF;
  IF v_line = 458 THEN RAISE SQLSTATE 'P0458'; END IF;
  IF v_line = 459 THEN RAISE SQLSTATE 'P0459'; END IF;
  IF v_line = 460 THEN RAISE SQLSTATE 'P0460'; END IF;
  IF v_line = 461 THEN RAISE SQLSTATE 'P0461'; END IF;
  IF v_line = 462 THEN RAISE SQLSTATE 'P0462'; END IF;
  IF v_line = 463 THEN RAISE SQLSTATE 'P0463'; END IF;
  IF v_line = 464 THEN RAISE SQLSTATE 'P0464'; END IF;
  IF v_line = 465 THEN RAISE SQLSTATE 'P0465'; END IF;
  IF v_line = 466 THEN RAISE SQLSTATE 'P0466'; END IF;
  IF v_line = 467 THEN RAISE SQLSTATE 'P0467'; END IF;
  IF v_line = 468 THEN RAISE SQLSTATE 'P0468'; END IF;
  IF v_line = 469 THEN RAISE SQLSTATE 'P0469'; END IF;
  IF v_line = 470 THEN RAISE SQLSTATE 'P0470'; END IF;
  IF v_line = 471 THEN RAISE SQLSTATE 'P0471'; END IF;
  IF v_line = 472 THEN RAISE SQLSTATE 'P0472'; END IF;
  IF v_line = 473 THEN RAISE SQLSTATE 'P0473'; END IF;
  IF v_line = 474 THEN RAISE SQLSTATE 'P0474'; END IF;
  IF v_line = 475 THEN RAISE SQLSTATE 'P0475'; END IF;
  IF v_line = 476 THEN RAISE SQLSTATE 'P0476'; END IF;
  IF v_line = 477 THEN RAISE SQLSTATE 'P0477'; END IF;
  IF v_line = 478 THEN RAISE SQLSTATE 'P0478'; END IF;
  IF v_line = 479 THEN RAISE SQLSTATE 'P0479'; END IF;
  IF v_line = 480 THEN RAISE SQLSTATE 'P0480'; END IF;
  IF v_line = 481 THEN RAISE SQLSTATE 'P0481'; END IF;
  IF v_line = 482 THEN RAISE SQLSTATE 'P0482'; END IF;
  IF v_line = 483 THEN RAISE SQLSTATE 'P0483'; END IF;
  IF v_line = 484 THEN RAISE SQLSTATE 'P0484'; END IF;
  IF v_line = 485 THEN RAISE SQLSTATE 'P0485'; END IF;
  IF v_line = 486 THEN RAISE SQLSTATE 'P0486'; END IF;
  IF v_line = 487 THEN RAISE SQLSTATE 'P0487'; END IF;
  IF v_line = 488 THEN RAISE SQLSTATE 'P0488'; END IF;
  IF v_line = 489 THEN RAISE SQLSTATE 'P0489'; END IF;
  IF v_line = 490 THEN RAISE SQLSTATE 'P0490'; END IF;
  IF v_line = 491 THEN RAISE SQLSTATE 'P0491'; END IF;
  IF v_line = 492 THEN RAISE SQLSTATE 'P0492'; END IF;
  IF v_line = 493 THEN RAISE SQLSTATE 'P0493'; END IF;
  IF v_line = 494 THEN RAISE SQLSTATE 'P0494'; END IF;
  IF v_line = 495 THEN RAISE SQLSTATE 'P0495'; END IF;
  IF v_line = 496 THEN RAISE SQLSTATE 'P0496'; END IF;
  IF v_line = 497 THEN RAISE SQLSTATE 'P0497'; END IF;
  IF v_line = 498 THEN RAISE SQLSTATE 'P0498'; END IF;
  IF v_line = 499 THEN RAISE SQLSTATE 'P0499'; END IF;
  IF v_line = 500 THEN RAISE SQLSTATE 'P0500'; END IF;
  IF v_line = 501 THEN RAISE SQLSTATE 'P0501'; END IF;
  IF v_line = 502 THEN RAISE SQLSTATE 'P0502'; END IF;
  IF v_line = 503 THEN RAISE SQLSTATE 'P0503'; END IF;
  IF v_line = 504 THEN RAISE SQLSTATE 'P0504'; END IF;
  IF v_line = 505 THEN RAISE SQLSTATE 'P0505'; END IF;
  IF v_line = 506 THEN RAISE SQLSTATE 'P0506'; END IF;
  IF v_line = 507 THEN RAISE SQLSTATE 'P0507'; END IF;
  IF v_line = 508 THEN RAISE SQLSTATE 'P0508'; END IF;
  IF v_line = 509 THEN RAISE SQLSTATE 'P0509'; END IF;
  IF v_line = 510 THEN RAISE SQLSTATE 'P0510'; END IF;
  IF v_line = 511 THEN RAISE SQLSTATE 'P0511'; END IF;
  IF v_line = 512 THEN RAISE SQLSTATE 'P0512'; END IF;
  IF v_line = 513 THEN RAISE SQLSTATE 'P0513'; END IF;
  IF v_line = 514 THEN RAISE SQLSTATE 'P0514'; END IF;
  IF v_line = 515 THEN RAISE SQLSTATE 'P0515'; END IF;
  IF v_line = 516 THEN RAISE SQLSTATE 'P0516'; END IF;
  IF v_line = 517 THEN RAISE SQLSTATE 'P0517'; END IF;
  IF v_line = 518 THEN RAISE SQLSTATE 'P0518'; END IF;
  IF v_line = 519 THEN RAISE SQLSTATE 'P0519'; END IF;
  IF v_line = 520 THEN RAISE SQLSTATE 'P0520'; END IF;
  IF v_line = 521 THEN RAISE SQLSTATE 'P0521'; END IF;
  IF v_line = 522 THEN RAISE SQLSTATE 'P0522'; END IF;
  IF v_line = 523 THEN RAISE SQLSTATE 'P0523'; END IF;
  IF v_line = 524 THEN RAISE SQLSTATE 'P0524'; END IF;
  IF v_line = 525 THEN RAISE SQLSTATE 'P0525'; END IF;
  IF v_line = 526 THEN RAISE SQLSTATE 'P0526'; END IF;
  IF v_line = 527 THEN RAISE SQLSTATE 'P0527'; END IF;
  IF v_line = 528 THEN RAISE SQLSTATE 'P0528'; END IF;
  IF v_line = 529 THEN RAISE SQLSTATE 'P0529'; END IF;
  IF v_line = 530 THEN RAISE SQLSTATE 'P0530'; END IF;
  IF v_line = 531 THEN RAISE SQLSTATE 'P0531'; END IF;
  IF v_line = 532 THEN RAISE SQLSTATE 'P0532'; END IF;
  IF v_line = 533 THEN RAISE SQLSTATE 'P0533'; END IF;
  IF v_line = 534 THEN RAISE SQLSTATE 'P0534'; END IF;
  IF v_line = 535 THEN RAISE SQLSTATE 'P0535'; END IF;
  IF v_line = 536 THEN RAISE SQLSTATE 'P0536'; END IF;
  IF v_line = 537 THEN RAISE SQLSTATE 'P0537'; END IF;
  IF v_line = 538 THEN RAISE SQLSTATE 'P0538'; END IF;
  IF v_line = 539 THEN RAISE SQLSTATE 'P0539'; END IF;
  IF v_line = 540 THEN RAISE SQLSTATE 'P0540'; END IF;
  IF v_line = 541 THEN RAISE SQLSTATE 'P0541'; END IF;
  IF v_line = 542 THEN RAISE SQLSTATE 'P0542'; END IF;
  IF v_line = 543 THEN RAISE SQLSTATE 'P0543'; END IF;
  IF v_line = 544 THEN RAISE SQLSTATE 'P0544'; END IF;
  IF v_line = 545 THEN RAISE SQLSTATE 'P0545'; END IF;
  IF v_line = 546 THEN RAISE SQLSTATE 'P0546'; END IF;
  IF v_line = 547 THEN RAISE SQLSTATE 'P0547'; END IF;
  IF v_line = 548 THEN RAISE SQLSTATE 'P0548'; END IF;
  IF v_line = 549 THEN RAISE SQLSTATE 'P0549'; END IF;
  IF v_line = 550 THEN RAISE SQLSTATE 'P0550'; END IF;
  IF v_line = 551 THEN RAISE SQLSTATE 'P0551'; END IF;
  IF v_line = 552 THEN RAISE SQLSTATE 'P0552'; END IF;
  IF v_line = 553 THEN RAISE SQLSTATE 'P0553'; END IF;
  IF v_line = 554 THEN RAISE SQLSTATE 'P0554'; END IF;
  IF v_line = 555 THEN RAISE SQLSTATE 'P0555'; END IF;
  IF v_line = 556 THEN RAISE SQLSTATE 'P0556'; END IF;
  IF v_line = 557 THEN RAISE SQLSTATE 'P0557'; END IF;
  IF v_line = 558 THEN RAISE SQLSTATE 'P0558'; END IF;
  IF v_line = 559 THEN RAISE SQLSTATE 'P0559'; END IF;
END
$behaviour$;

ROLLBACK;

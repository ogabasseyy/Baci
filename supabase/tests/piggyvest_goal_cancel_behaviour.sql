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
  EXECUTE pg_catalog.format('DO $x$ BEGIN RAISE EXCEPTION ''diag'' USING ERRCODE = %L; END $x$',
    'P' || pg_catalog.lpad(COALESCE(pg_catalog.substring(v_ctx from 'inline_code_block line ([0-9]+)'), '9999'), 4, '0'));
END
$behaviour$;

ROLLBACK;

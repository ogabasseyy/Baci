-- REGRESSION TEST (behaviour): reserve_savings_with_pin reserves a goal
-- funding transfer only when it spends a matching single-use PIN proof, and
-- a refused proof leaves nothing behind (migration 20261103044600).
--
-- Synthetic, transaction-local fixture; the final ROLLBACK removes it. The
-- fixture binds to the replay connection's SESSION_USER, as the recovery
-- suite does. Proofs are written directly as owner rows with test tokens
-- derived from labels (no PIN is typed, so no pepper or attestation is
-- involved); the spend function under test reads them like real ones.
--
-- Registered in the replay registry folder 20261103044600_piggyvest_goal_pin_proofs.

BEGIN;

UPDATE piggyvest_primary.integrations SET executor_login = 'retired-' || id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.savings_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;

INSERT INTO auth.users (id, email) VALUES
  ('f3830000-0000-4000-8000-000000000001', 'piggyvest-goalpin@example.test');
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3830000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f3830000-0000-4000-8000-000000000002', 'f3830000-0000-4000-8000-000000000001',
   'piggyvest-goalpin@example.test', 'PiggyVest Goal PIN Fixture', 'piggyvest-goalpin-fixture');
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES
  ('f3830000-0000-4000-8000-000000000003', 'f3830000-0000-4000-8000-000000000002',
   'f3830000-0000-4000-8000-000000000001', 'piggyvest-goalpin-customer@example.test');
INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity) VALUES
  ('f3830000-0000-4000-8000-000000000004', 'f3830000-0000-4000-8000-000000000002',
   'Synthetic goal PIN product', 10000, 'active', 1);
INSERT INTO public.customer_savings_goals (
  id, merchant_id, customer_id, product_id, title, target_amount, current_amount,
  contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
  terms_accepted_at, non_withdrawable_accepted_at
) VALUES (
  'f3830000-0000-4000-8000-000000000005', 'f3830000-0000-4000-8000-000000000002',
  'f3830000-0000-4000-8000-000000000003', 'f3830000-0000-4000-8000-000000000004',
  'Synthetic goal PIN goal', 10000, 0, 1000, 'daily', current_date, current_date + 30,
  'manual', now(), now());
INSERT INTO piggyvest_primary.integrations
  (id, merchant_id, business_id, environment, executor_login, enabled)
VALUES ('f3830000-0000-4000-8000-000000000006', 'f3830000-0000-4000-8000-000000000002',
  'synthetic-goalpin-business', 'staging', SESSION_USER, true);
INSERT INTO piggyvest_primary.savings_authorities (integration_id, executor_login, enabled)
VALUES ('f3830000-0000-4000-8000-000000000006', SESSION_USER, true);
INSERT INTO piggyvest_primary.onboarding_intents (
  id, integration_id, merchant_id, customer_id, user_id, request_fingerprint, state,
  provider_customer_id, provider_wallet_id
) VALUES (
  'f3830000-0000-4000-8000-000000000007', 'f3830000-0000-4000-8000-000000000006',
  'f3830000-0000-4000-8000-000000000002', 'f3830000-0000-4000-8000-000000000003',
  'f3830000-0000-4000-8000-000000000001', repeat('b', 64), 'accepted',
  'synthetic-goalpin-customer', 'synthetic-goalpin-source');
INSERT INTO piggyvest_primary.savings_destinations (integration_id, goal_id, intent_id, provider_wallet_id, enabled)
VALUES ('f3830000-0000-4000-8000-000000000006', 'f3830000-0000-4000-8000-000000000005',
  'f3830000-0000-4000-8000-000000000007', 'synthetic-goalpin-destination', true);
INSERT INTO public.customer_wallets (id, customer_id, merchant_id, available_balance) VALUES
  ('f3830000-0000-4000-8000-000000000008', 'f3830000-0000-4000-8000-000000000003',
   'f3830000-0000-4000-8000-000000000002', 1000);
INSERT INTO public.customer_wallet_transactions (
  id, wallet_id, customer_id, merchant_id, type, amount, balance_after, status
) VALUES (
  'f3830000-0000-4000-8000-000000000009', 'f3830000-0000-4000-8000-000000000008',
  'f3830000-0000-4000-8000-000000000003', 'f3830000-0000-4000-8000-000000000002',
  'adjustment', 1000, 1000, 'completed');
INSERT INTO piggyvest_primary.inflow_receipts (
  integration_id, intent_id, provider_transaction_id, event_id, body_digest,
  financial_identity, wallet_transaction_id
) VALUES (
  'f3830000-0000-4000-8000-000000000006', 'f3830000-0000-4000-8000-000000000007',
  'synthetic-goalpin-inflow', 'synthetic-goalpin-event', repeat('c', 64),
  '{"amountKobo":100000}', 'f3830000-0000-4000-8000-000000000009');
-- PIN authority and a PIN row bound to this customer and account, so a proof
-- is spendable. The hash values are label-derived and never verified here.
INSERT INTO wallet_pin_private.merchant_authorities (merchant_id, enabled)
VALUES ('f3830000-0000-4000-8000-000000000002', true);
INSERT INTO wallet_pin_private.customer_pins (
  customer_id, user_id, merchant_id, kdf_version, pepper_id, salt, pin_hash)
VALUES (
  'f3830000-0000-4000-8000-000000000003', 'f3830000-0000-4000-8000-000000000001',
  'f3830000-0000-4000-8000-000000000002', 1,
  pg_catalog.substr(pg_catalog.sha256(pg_catalog.convert_to('goalpin-pepper', 'UTF8')), 1, 8),
  pg_catalog.substr(pg_catalog.sha256(pg_catalog.convert_to('goalpin-salt', 'UTF8')), 1, 16),
  pg_catalog.sha256(pg_catalog.convert_to('goalpin-hash', 'UTF8')));
SELECT set_config('test.goalpin_scope', jsonb_build_object(
  'merchantId', 'f3830000-0000-4000-8000-000000000002',
  'customerId', 'f3830000-0000-4000-8000-000000000003',
  'userId', 'f3830000-0000-4000-8000-000000000001',
  'integrationId', 'f3830000-0000-4000-8000-000000000006',
  'businessId', 'synthetic-goalpin-business', 'environment', 'staging')::text, true);

-- Test helpers. A proof token is the hex SHA-256 of a label.
CREATE FUNCTION pg_temp.gp_token(p_label text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_label, 'UTF8')), 'hex');
$$;
-- Issues a proof row for the given binding; p_age_seconds moves it into the past.
CREATE FUNCTION pg_temp.gp_issue(
  p_label text, p_purpose text, p_amount bigint, p_key_text text, p_age_seconds integer DEFAULT 0)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_issued timestamptz := pg_catalog.clock_timestamp() - (p_age_seconds || ' seconds')::interval;
BEGIN
  INSERT INTO wallet_pin_private.proofs (
    token_sha256, customer_id, merchant_id, purpose, amount_kobo,
    idempotency_key_sha256, issued_at, expires_at)
  VALUES (
    pg_catalog.sha256(pg_catalog.decode(pg_temp.gp_token(p_label), 'hex')),
    'f3830000-0000-4000-8000-000000000003', 'f3830000-0000-4000-8000-000000000002',
    p_purpose, p_amount,
    pg_catalog.sha256(pg_catalog.convert_to(p_key_text, 'UTF8')),
    v_issued, v_issued + interval '120 seconds');
  RETURN pg_temp.gp_token(p_label);
END;
$$;
CREATE FUNCTION pg_temp.gp_request(p_operation text, p_amount bigint)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_catalog.jsonb_build_object(
    'goalId', 'f3830000-0000-4000-8000-000000000005',
    'operationId', p_operation, 'amountKobo', p_amount);
$$;
CREATE FUNCTION pg_temp.gp_call(p_operation text, p_amount bigint, p_proof text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.reserve_savings_with_pin(
    pg_catalog.current_setting('test.goalpin_scope')::jsonb,
    pg_temp.gp_request(p_operation, p_amount), p_proof);
$$;
CREATE FUNCTION pg_temp.gp_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'goal pin behaviour: %', p_message; END IF;
END;
$$;
CREATE FUNCTION pg_temp.gp_operations() RETURNS bigint LANGUAGE sql AS $$
  SELECT pg_catalog.count(*) FROM piggyvest_primary.savings_operations;
$$;
CREATE FUNCTION pg_temp.gp_balance() RETURNS numeric LANGUAGE sql AS $$
  SELECT available_balance FROM public.customer_wallets
   WHERE id = 'f3830000-0000-4000-8000-000000000008';
$$;
CREATE FUNCTION pg_temp.gp_spent(p_label text) RETURNS boolean LANGUAGE sql AS $$
  SELECT consumed_at IS NOT NULL FROM wallet_pin_private.proofs
   WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(pg_temp.gp_token(p_label), 'hex'));
$$;

DO $behaviour$
DECLARE
  c_goal constant text := 'f3830000-0000-4000-8000-000000000005';
  c_op1 constant text := 'f3830000-0000-4000-8000-0000000000a1';
  c_op2 constant text := 'f3830000-0000-4000-8000-0000000000a2';
  c_op3 constant text := 'f3830000-0000-4000-8000-0000000000a3';
  c_op4 constant text := 'f3830000-0000-4000-8000-0000000000a4';
  c_op5 constant text := 'f3830000-0000-4000-8000-0000000000a5';
  c_other_goal constant text := 'f3830000-0000-4000-8000-0000000000ff';
  v_result jsonb;
BEGIN
  -- No proof, or garbage: refused, and nothing is left behind.
  v_result := pg_temp.gp_call(c_op1, 5000, NULL);
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'pin_refused' AND v_result ->> 'reason' = 'missing',
    'missing proof: ' || v_result::text);
  v_result := pg_temp.gp_call(c_op1, 5000, 'not-a-proof');
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'pin_refused' AND v_result ->> 'reason' = 'invalid',
    'garbage proof: ' || v_result::text);
  v_result := pg_temp.gp_call(c_op1, 5000, pg_temp.gp_token('unknown-proof'));
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'pin_refused' AND v_result ->> 'reason' = 'invalid',
    'unknown proof: ' || v_result::text);
  PERFORM pg_temp.gp_assert(pg_temp.gp_operations() = 0 AND pg_temp.gp_balance() = 1000,
    'refusal left a reservation or a hold');

  -- A proof for another amount, another purpose, the operation alone, or
  -- another goal is a mismatch: refused, rolled back, and left unspent.
  PERFORM pg_temp.gp_issue('wrong-amount', 'goal_fund', 5001, c_goal || ':' || c_op1);
  v_result := pg_temp.gp_call(c_op1, 5000, pg_temp.gp_token('wrong-amount'));
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'pin_refused' AND v_result ->> 'reason' = 'mismatch',
    'wrong amount: ' || v_result::text);
  PERFORM pg_temp.gp_issue('wrong-purpose', 'goal_cancel', 5000, c_goal || ':' || c_op1);
  v_result := pg_temp.gp_call(c_op1, 5000, pg_temp.gp_token('wrong-purpose'));
  PERFORM pg_temp.gp_assert(v_result ->> 'reason' = 'mismatch', 'wrong purpose: ' || v_result::text);
  PERFORM pg_temp.gp_issue('operation-only', 'goal_fund', 5000, c_op1);
  v_result := pg_temp.gp_call(c_op1, 5000, pg_temp.gp_token('operation-only'));
  PERFORM pg_temp.gp_assert(v_result ->> 'reason' = 'mismatch', 'operation-only key: ' || v_result::text);
  PERFORM pg_temp.gp_issue('other-goal', 'goal_fund', 5000, c_other_goal || ':' || c_op1);
  v_result := pg_temp.gp_call(c_op1, 5000, pg_temp.gp_token('other-goal'));
  PERFORM pg_temp.gp_assert(v_result ->> 'reason' = 'mismatch', 'other goal key: ' || v_result::text);
  PERFORM pg_temp.gp_issue('other-operation', 'goal_fund', 5000, c_goal || ':' || c_op2);
  v_result := pg_temp.gp_call(c_op1, 5000, pg_temp.gp_token('other-operation'));
  PERFORM pg_temp.gp_assert(v_result ->> 'reason' = 'mismatch', 'other operation key: ' || v_result::text);
  PERFORM pg_temp.gp_assert(pg_temp.gp_operations() = 0 AND pg_temp.gp_balance() = 1000,
    'mismatch left a reservation or a hold');
  PERFORM pg_temp.gp_assert(NOT pg_temp.gp_spent('wrong-amount') AND NOT pg_temp.gp_spent('other-goal'),
    'a mismatched proof was spent');

  -- An expired proof is refused and rolled back.
  PERFORM pg_temp.gp_issue('expired', 'goal_fund', 5000, c_goal || ':' || c_op3, 121);
  v_result := pg_temp.gp_call(c_op3, 5000, pg_temp.gp_token('expired'));
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'pin_refused' AND v_result ->> 'reason' = 'expired',
    'expired proof: ' || v_result::text);
  PERFORM pg_temp.gp_assert(pg_temp.gp_operations() = 0 AND pg_temp.gp_balance() = 1000,
    'expired proof left a reservation or a hold');

  -- A request with no goal id is invalid, never defaulted.
  BEGIN
    PERFORM piggyvest_primary.reserve_savings_with_pin(
      pg_catalog.current_setting('test.goalpin_scope')::jsonb,
      pg_temp.gp_request(c_op1, 5000) - 'goalId', pg_temp.gp_token('wrong-amount'));
    RAISE EXCEPTION 'request without a goal id was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- Insufficient funds are reported without needing or spending a proof.
  PERFORM pg_temp.gp_issue('too-large', 'goal_fund', 200000, c_goal || ':' || c_op4);
  v_result := pg_temp.gp_call(c_op4, 200000, pg_temp.gp_token('too-large'));
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'insufficient', 'insufficient: ' || v_result::text);
  PERFORM pg_temp.gp_assert(NOT pg_temp.gp_spent('too-large'), 'a proof was spent on a refused reservation');

  -- The exact proof reserves the transfer and is spent with it. The unspent
  -- wrong-amount proof shares its live binding, so it is removed first.
  DELETE FROM wallet_pin_private.proofs
   WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(pg_temp.gp_token('wrong-amount'), 'hex'));
  PERFORM pg_temp.gp_issue('exact', 'goal_fund', 5000, c_goal || ':' || c_op1);
  v_result := pg_temp.gp_call(c_op1, 5000, pg_temp.gp_token('exact'));
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'claimed', 'exact proof: ' || v_result::text);
  PERFORM pg_temp.gp_assert(pg_temp.gp_operations() = 1 AND pg_temp.gp_balance() = 1000,
    'reservation missing, or legacy wallet changed, after a spent proof');
  PERFORM pg_temp.gp_assert(pg_temp.gp_spent('exact'), 'the proof was not spent with the reservation');

  -- A replay of the reserved operation needs no new proof and spends none.
  v_result := pg_temp.gp_call(c_op1, 5000, NULL);
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'pending', 'replay without proof: ' || v_result::text);
  v_result := pg_temp.gp_call(c_op1, 5000, pg_temp.gp_token('exact'));
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'pending', 'replay with spent proof: ' || v_result::text);
  PERFORM pg_temp.gp_assert(pg_temp.gp_operations() = 1 AND pg_temp.gp_balance() = 1000,
    'replay changed the reservation');

  -- Only one transfer per goal may be in flight (primary_savings_single_pending_goal_idx),
  -- so the reserved row is removed to let the next claim be attempted. The
  -- reservation never touches the legacy wallet, so the balance stays 1000.
  DELETE FROM piggyvest_primary.savings_operations WHERE id = c_op1::uuid;

  -- A spent proof cannot fund a different operation.
  v_result := pg_temp.gp_call(c_op2, 5000, pg_temp.gp_token('exact'));
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'pin_refused' AND v_result ->> 'reason' = 'mismatch',
    'spent proof reused: ' || v_result::text);
  PERFORM pg_temp.gp_assert(pg_temp.gp_operations() = 0 AND pg_temp.gp_balance() = 1000,
    'reused proof left a reservation');

  -- Cancel and complete proofs are spent only for an active goal of this
  -- customer and merchant; a foreign or missing goal leaves the proof unspent.
  PERFORM pg_temp.gp_issue('cancel-ok', 'goal_cancel', 1, c_goal || ':cancel');
  PERFORM pg_temp.gp_issue('cancel-foreign', 'goal_cancel', 1, c_other_goal || ':cancel');
  BEGIN
    PERFORM piggyvest_primary.consume_goal_pin_proof(
      pg_catalog.current_setting('test.goalpin_scope')::jsonb,
      c_other_goal::uuid, 'cancel', pg_temp.gp_token('cancel-foreign'));
    RAISE EXCEPTION 'a proof was spent for a missing goal';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  PERFORM pg_temp.gp_assert(NOT pg_temp.gp_spent('cancel-foreign'),
    'a proof for a missing goal was spent');
  PERFORM pg_temp.gp_assert(
    piggyvest_primary.consume_goal_pin_proof(
      pg_catalog.current_setting('test.goalpin_scope')::jsonb,
      c_goal::uuid, 'cancel', pg_temp.gp_token('cancel-ok')) = 'consumed',
    'cancel proof for the owned goal was not spent');
  PERFORM pg_temp.gp_assert(pg_temp.gp_spent('cancel-ok'), 'the cancel proof is not marked spent');
  -- Any outcome other than a spent proof raises (PVP01), so the caller's
  -- transaction rolls back: a spent proof, and a complete proof used for cancel.
  BEGIN
    PERFORM piggyvest_primary.consume_goal_pin_proof(
      pg_catalog.current_setting('test.goalpin_scope')::jsonb,
      c_goal::uuid, 'cancel', pg_temp.gp_token('cancel-ok'));
    RAISE EXCEPTION 'a spent cancel proof was accepted again';
  EXCEPTION WHEN SQLSTATE 'PVP01' THEN
    PERFORM pg_temp.gp_assert(SQLERRM = 'pin_refused:used', 'spent cancel proof: ' || SQLERRM);
  END;
  PERFORM pg_temp.gp_issue('complete-ok', 'goal_complete', 1, c_goal || ':complete');
  BEGIN
    PERFORM piggyvest_primary.consume_goal_pin_proof(
      pg_catalog.current_setting('test.goalpin_scope')::jsonb,
      c_goal::uuid, 'cancel', pg_temp.gp_token('complete-ok'));
    RAISE EXCEPTION 'a complete proof was accepted for cancel';
  EXCEPTION WHEN SQLSTATE 'PVP01' THEN
    PERFORM pg_temp.gp_assert(SQLERRM = 'pin_refused:mismatch', 'complete proof for cancel: ' || SQLERRM);
  END;
  PERFORM pg_temp.gp_assert(NOT pg_temp.gp_spent('complete-ok'), 'a mismatched complete proof was spent');
  BEGIN
    PERFORM piggyvest_primary.consume_goal_pin_proof(
      pg_catalog.current_setting('test.goalpin_scope')::jsonb, c_goal::uuid, 'cancel', NULL);
    RAISE EXCEPTION 'a missing cancel proof was accepted';
  EXCEPTION WHEN SQLSTATE 'PVP01' THEN
    PERFORM pg_temp.gp_assert(SQLERRM = 'pin_refused:missing', 'missing cancel proof: ' || SQLERRM);
  END;
  -- A merchant switched off after issue: unavailable, rolled back.
  PERFORM pg_temp.gp_issue('switched-off', 'goal_fund', 5000, c_goal || ':' || c_op5);
  UPDATE wallet_pin_private.merchant_authorities SET enabled = false
   WHERE merchant_id = 'f3830000-0000-4000-8000-000000000002';
  v_result := pg_temp.gp_call(c_op5, 5000, pg_temp.gp_token('switched-off'));
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'pin_refused' AND v_result ->> 'reason' = 'unavailable',
    'merchant off: ' || v_result::text);
  PERFORM pg_temp.gp_assert(pg_temp.gp_operations() = 0 AND pg_temp.gp_balance() = 1000
    AND NOT pg_temp.gp_spent('switched-off'), 'merchant off left a reservation or spent a proof');
  -- A merchant with PIN checking off funds with no proof (empty or missing);
  -- the reservation stands and nothing is spent. A garbage proof is still refused.
  v_result := pg_temp.gp_call(c_op5, 5000, 'not-a-proof');
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'pin_refused' AND v_result ->> 'reason' = 'invalid',
    'merchant off with garbage proof: ' || v_result::text);
  v_result := pg_temp.gp_call(c_op5, 5000, '');
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'claimed', 'merchant off without proof: ' || v_result::text);
  PERFORM pg_temp.gp_assert(pg_temp.gp_operations() = 1 AND pg_temp.gp_balance() = 1000
    AND NOT pg_temp.gp_spent('switched-off'), 'merchant off funding changed a proof or the hold');

  -- The operation c_op5 was reserved while checking was off and is still
  -- pending. Once checking is switched on, a replay may not be sent without a
  -- proof; a wrong proof is refused; the exact proof is spent once and then
  -- later replays pass without another.
  UPDATE wallet_pin_private.merchant_authorities SET enabled = true
   WHERE merchant_id = 'f3830000-0000-4000-8000-000000000002';
  v_result := pg_temp.gp_call(c_op5, 5000, NULL);
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'pin_refused' AND v_result ->> 'reason' = 'missing',
    'pending replay after enabling without proof: ' || v_result::text);
  DELETE FROM wallet_pin_private.proofs
   WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(pg_temp.gp_token('switched-off'), 'hex'));
  PERFORM pg_temp.gp_issue('replay-wrong', 'goal_fund', 5001, c_goal || ':' || c_op5);
  v_result := pg_temp.gp_call(c_op5, 5000, pg_temp.gp_token('replay-wrong'));
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'pin_refused' AND v_result ->> 'reason' = 'mismatch',
    'pending replay with a wrong proof: ' || v_result::text);
  DELETE FROM wallet_pin_private.proofs
   WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(pg_temp.gp_token('replay-wrong'), 'hex'));
  PERFORM pg_temp.gp_issue('replay-exact', 'goal_fund', 5000, c_goal || ':' || c_op5);
  v_result := pg_temp.gp_call(c_op5, 5000, pg_temp.gp_token('replay-exact'));
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'pending', 'pending replay with the exact proof: ' || v_result::text);
  PERFORM pg_temp.gp_assert(pg_temp.gp_spent('replay-exact') AND pg_temp.gp_operations() = 1
    AND pg_temp.gp_balance() = 1000, 'the replay proof was not spent or the reservation changed');
  v_result := pg_temp.gp_call(c_op5, 5000, NULL);
  PERFORM pg_temp.gp_assert(v_result ->> 'status' = 'pending', 'replay after the proof was spent: ' || v_result::text);
  -- Pinned vectors shared with goal-pin-binding.test.ts: the TypeScript
  -- binding and the SQL key text must hash the same bytes to the same digest.
  PERFORM pg_temp.gp_assert(
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'UTF8')), 'hex')
      = '05cb93fe83c97235778776801f1f9f4d602f7bc66cded386cb49d66312789811'
    AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:cancel', 'UTF8')), 'hex')
      = '5fd298ab6c53da67ab0e70e3c51343e4667c2f24667eb4b1e3c335dd29e9e5e7'
    AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:complete', 'UTF8')), 'hex')
      = '06c1da1b8fcf092edd91e05a10a3ea7c3f68a89fece21b85578b63e00abbd605',
    'TypeScript and SQL goal PIN binding vectors drifted');
END
$behaviour$;

ROLLBACK;

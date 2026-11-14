-- REGRESSION TEST (behaviour): goal funding from the PiggyVest main wallet is
-- not gated by, and never touches, the legacy in-house balance
-- (migrations 20261104130500 to 20261104130800, piggyvest_goal_funding_*).
--
-- Before the fix the reservation read and debited public.customer_wallets, which
-- PiggyVest deposits no longer credit, so a customer with PiggyVest money and a
-- zero legacy balance always got 'insufficient'. This suite proves, for a
-- primary-rail customer whose legacy wallet holds 0:
--   * a funding reservation is claimed, and the legacy wallet row and wallet
--     transaction history are untouched;
--   * the reservation row carries no legacy wallet transaction;
--   * replaying the operation is idempotent (one row, status 'pending');
--   * the customer has ZERO recorded deposit receipts (money in the PiggyVest
--     main wallet that is not a recorded deposit, such as paid interest or a
--     merchant top-up, must be usable) and still reserves: the database never
--     gates on a local balance, PiggyVest's own balance is the authority;
--   * the only database limit left is the goal's remaining target capacity;
--   * cancel, terminal provider failure (release) and settlement work for an
--     operation with no legacy hold, and settlement writes its contribution;
--   * the legacy contribution path is unchanged: a customer with no balance is
--     still refused with 'insufficient_wallet_balance' and a legacy wallet row
--     is still what it reads.
--
-- Synthetic, transaction-local fixture; the final ROLLBACK removes it. The
-- fixture binds to the replay connection's SESSION_USER, as the recovery suite
-- does. Failures are never swallowed: the one exception block re-raises every
-- error that is not the exact legacy refusal under test.
--
-- Registered in replay registry folder 20261104130800_piggyvest_goal_funding_reserve.

BEGIN;

UPDATE piggyvest_primary.integrations SET executor_login = 'retired-' || id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.savings_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.inflow_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;

INSERT INTO auth.users (id, email) VALUES
  ('f3880000-0000-4000-8000-000000000001', 'piggyvest-fundbal@example.test'),
  ('f3880000-0000-4000-8000-000000000011', 'piggyvest-fundbal-legacy@example.test');
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3880000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f3880000-0000-4000-8000-000000000002', 'f3880000-0000-4000-8000-000000000001',
   'piggyvest-fundbal@example.test', 'PiggyVest Funding Balance Fixture', 'piggyvest-fundbal-fixture');
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES
  ('f3880000-0000-4000-8000-000000000003', 'f3880000-0000-4000-8000-000000000002',
   'f3880000-0000-4000-8000-000000000001', 'piggyvest-fundbal-customer@example.test'),
  ('f3880000-0000-4000-8000-000000000012', 'f3880000-0000-4000-8000-000000000002',
   'f3880000-0000-4000-8000-000000000011', 'piggyvest-fundbal-legacy-customer@example.test');
INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity) VALUES
  ('f3880000-0000-4000-8000-000000000004', 'f3880000-0000-4000-8000-000000000002',
   'Synthetic funding balance product', 10000, 'active', 1);
INSERT INTO public.customer_savings_goals (
  id, merchant_id, customer_id, product_id, title, target_amount, current_amount,
  contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
  terms_accepted_at, non_withdrawable_accepted_at
) VALUES
  ('f3880000-0000-4000-8000-000000000005', 'f3880000-0000-4000-8000-000000000002',
   'f3880000-0000-4000-8000-000000000003', 'f3880000-0000-4000-8000-000000000004',
   'Synthetic primary goal', 10000, 0, 1000, 'daily', current_date, current_date + 30,
   'manual', now(), now()),
  ('f3880000-0000-4000-8000-000000000013', 'f3880000-0000-4000-8000-000000000002',
   'f3880000-0000-4000-8000-000000000012', 'f3880000-0000-4000-8000-000000000004',
   'Synthetic legacy goal', 10000, 0, 1000, 'daily', current_date, current_date + 30,
   'manual', now(), now());
INSERT INTO piggyvest_primary.integrations
  (id, merchant_id, business_id, environment, executor_login, enabled)
VALUES ('f3880000-0000-4000-8000-000000000006', 'f3880000-0000-4000-8000-000000000002',
  'synthetic-fundbal-business', 'staging', SESSION_USER, true);
INSERT INTO piggyvest_primary.savings_authorities (integration_id, executor_login, enabled)
VALUES ('f3880000-0000-4000-8000-000000000006', SESSION_USER, true);
INSERT INTO piggyvest_primary.inflow_authorities (integration_id, executor_login, enabled)
VALUES ('f3880000-0000-4000-8000-000000000006', SESSION_USER, true);
INSERT INTO piggyvest_primary.onboarding_intents (
  id, integration_id, merchant_id, customer_id, user_id, request_fingerprint, state,
  provider_customer_id, provider_wallet_id
) VALUES (
  'f3880000-0000-4000-8000-000000000007', 'f3880000-0000-4000-8000-000000000006',
  'f3880000-0000-4000-8000-000000000002', 'f3880000-0000-4000-8000-000000000003',
  'f3880000-0000-4000-8000-000000000001', repeat('d', 64), 'accepted',
  'synthetic-fundbal-customer', 'synthetic-fundbal-source');
INSERT INTO piggyvest_primary.savings_destinations (integration_id, goal_id, intent_id, provider_wallet_id, enabled)
VALUES ('f3880000-0000-4000-8000-000000000006', 'f3880000-0000-4000-8000-000000000005',
  'f3880000-0000-4000-8000-000000000007', 'synthetic-fundbal-destination', true);
-- The legacy wallet of the primary customer holds ZERO.
INSERT INTO public.customer_wallets (id, customer_id, merchant_id, available_balance) VALUES
  ('f3880000-0000-4000-8000-000000000008', 'f3880000-0000-4000-8000-000000000003',
   'f3880000-0000-4000-8000-000000000002', 0);
-- No inflow receipt is recorded. The legacy customer has an empty wallet, no PiggyVest binding.
INSERT INTO public.customer_wallets (id, customer_id, merchant_id, available_balance) VALUES
  ('f3880000-0000-4000-8000-000000000018', 'f3880000-0000-4000-8000-000000000012',
   'f3880000-0000-4000-8000-000000000002', 0);
SELECT set_config('test.fundbal_scope', jsonb_build_object(
  'merchantId', 'f3880000-0000-4000-8000-000000000002',
  'customerId', 'f3880000-0000-4000-8000-000000000003',
  'userId', 'f3880000-0000-4000-8000-000000000001',
  'integrationId', 'f3880000-0000-4000-8000-000000000006',
  'businessId', 'synthetic-fundbal-business', 'environment', 'staging')::text, true);
-- Snapshot of the legacy wallet row so "untouched" includes updated_at.
SELECT set_config('test.fundbal_wallet_snapshot', (
  SELECT pg_catalog.to_jsonb(wallet)::text FROM public.customer_wallets AS wallet
   WHERE wallet.id = 'f3880000-0000-4000-8000-000000000008'), true);

CREATE FUNCTION pg_temp.fb_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'funding balance: %', p_message; END IF;
END;
$$;
CREATE FUNCTION pg_temp.fb_reserve(p_operation text, p_amount bigint)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.reserve_savings(
    pg_catalog.current_setting('test.fundbal_scope')::jsonb,
    pg_catalog.jsonb_build_object(
      'goalId', 'f3880000-0000-4000-8000-000000000005',
      'operationId', p_operation, 'amountKobo', p_amount));
$$;
CREATE FUNCTION pg_temp.fb_proof(p_operation text, p_amount bigint)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_catalog.jsonb_build_object(
    'operationId', p_operation, 'providerTransactionId', 'fundbal-tx-' || p_operation,
    'reference', 'pvb-save-' || p_operation, 'amountKobo', p_amount,
    'sourceWalletId', 'synthetic-fundbal-source',
    'destinationWalletId', 'synthetic-fundbal-destination',
    'businessId', 'synthetic-fundbal-business');
$$;
-- True while the primary customer's legacy wallet row and history are untouched.
CREATE FUNCTION pg_temp.fb_legacy_untouched() RETURNS boolean LANGUAGE sql AS $$
  SELECT (SELECT pg_catalog.to_jsonb(wallet)::text FROM public.customer_wallets AS wallet
           WHERE wallet.id = 'f3880000-0000-4000-8000-000000000008')
         = pg_catalog.current_setting('test.fundbal_wallet_snapshot')
     AND NOT EXISTS (SELECT 1 FROM public.customer_wallet_transactions AS tx
                      WHERE tx.customer_id = 'f3880000-0000-4000-8000-000000000003');
$$;
CREATE FUNCTION pg_temp.fb_state(p_operation text) RETURNS text LANGUAGE sql AS $$
  SELECT state FROM piggyvest_primary.savings_operations WHERE id = p_operation::uuid;
$$;

DO $behaviour$
DECLARE
  c_op1 constant text := 'f3880000-0000-4000-8000-0000000000a1';
  c_op2 constant text := 'f3880000-0000-4000-8000-0000000000a2';
  c_op3 constant text := 'f3880000-0000-4000-8000-0000000000a3';
  c_op4 constant text := 'f3880000-0000-4000-8000-0000000000a4';
  c_op5 constant text := 'f3880000-0000-4000-8000-0000000000a5';
  c_op6 constant text := 'f3880000-0000-4000-8000-0000000000a6';
  c_integration constant uuid := 'f3880000-0000-4000-8000-000000000006';
  v_scope jsonb := pg_catalog.current_setting('test.fundbal_scope')::jsonb;
  v_result jsonb;
  v_refused boolean := false;
BEGIN
  -- A primary customer with a zero legacy balance can reserve.
  v_result := pg_temp.fb_reserve(c_op1, 5000);
  PERFORM pg_temp.fb_assert(v_result ->> 'status' = 'claimed', 'zero legacy balance could not reserve: ' || v_result::text);
  PERFORM pg_temp.fb_assert(pg_temp.fb_state(c_op1) = 'reserved', 'the reservation row is missing');
  PERFORM pg_temp.fb_assert(
    (SELECT wallet_transaction_id FROM piggyvest_primary.savings_operations WHERE id = c_op1::uuid) IS NULL,
    'a primary reservation carries a legacy wallet transaction');
  PERFORM pg_temp.fb_assert(pg_temp.fb_legacy_untouched(), 'reserving changed the legacy wallet or its history');

  -- Replaying the same operation is idempotent: no second row, no new effect.
  v_result := pg_temp.fb_reserve(c_op1, 5000);
  PERFORM pg_temp.fb_assert(v_result ->> 'status' = 'pending', 'replay was not pending: ' || v_result::text);
  PERFORM pg_temp.fb_assert(
    (SELECT pg_catalog.count(*) FROM piggyvest_primary.savings_operations) = 1
    AND pg_temp.fb_legacy_untouched(), 'replay created a second reservation or touched the legacy wallet');
  v_result := pg_temp.fb_reserve(c_op1, 5001);
  PERFORM pg_temp.fb_assert(v_result ->> 'status' = 'conflict', 'replay with another amount was not a conflict: ' || v_result::text);

  -- Only the goal's remaining capacity bounds a reservation (no local balance gate).
  PERFORM pg_temp.fb_assert(
    piggyvest_primary.manage_savings(v_scope, c_op1::uuid, 'cancel'), 'the hold-free reservation was not cancelled');
  PERFORM pg_temp.fb_assert(pg_temp.fb_state(c_op1) = 'cancelled' AND pg_temp.fb_legacy_untouched(),
    'cancel changed the legacy wallet or did not cancel');
  v_result := pg_temp.fb_reserve(c_op4, 1000001);
  PERFORM pg_temp.fb_assert(v_result ->> 'status' = 'insufficient', 'above the goal capacity was not refused: ' || v_result::text);
  PERFORM pg_temp.fb_assert(pg_temp.fb_legacy_untouched()
    AND NOT EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations WHERE id = c_op4::uuid),
    'a refused reservation left a row or touched the legacy wallet');

  -- Terminal provider failure releases a hold-free operation and frees the goal.
  v_result := pg_temp.fb_reserve(c_op2, 5000);
  PERFORM pg_temp.fb_assert(v_result ->> 'status' = 'claimed', 'second reservation: ' || v_result::text);
  PERFORM pg_temp.fb_assert(piggyvest_primary.manage_savings(v_scope, c_op2::uuid, 'dispatch'), 'dispatch failed');
  PERFORM pg_temp.fb_assert(
    piggyvest_primary.release_failed_savings(c_integration, 'staging', pg_temp.fb_proof(c_op2, 5000)) = 'released',
    'a hold-free failed transfer was not released');
  PERFORM pg_temp.fb_assert(
    piggyvest_primary.release_failed_savings(c_integration, 'staging', pg_temp.fb_proof(c_op2, 5000)) = 'duplicate',
    'release replay was not idempotent');
  PERFORM pg_temp.fb_assert(pg_temp.fb_state(c_op2) = 'cancelled' AND pg_temp.fb_legacy_untouched(),
    'release did not cancel, or changed the legacy wallet');

  -- A definitive-refusal release by the application action is also hold-free.
  v_result := pg_temp.fb_reserve(c_op3, 5000);
  PERFORM pg_temp.fb_assert(v_result ->> 'status' = 'claimed', 'third reservation: ' || v_result::text);
  PERFORM pg_temp.fb_assert(piggyvest_primary.manage_savings(v_scope, c_op3::uuid, 'dispatch'), 'dispatch of the third failed');
  PERFORM pg_temp.fb_assert(piggyvest_primary.manage_savings(v_scope, c_op3::uuid, 'release'), 'release action failed');
  PERFORM pg_temp.fb_assert(pg_temp.fb_state(c_op3) = 'cancelled' AND pg_temp.fb_legacy_untouched(),
    'release action did not cancel, or changed the legacy wallet');

  -- Settlement of a hold-free operation credits the goal and writes its contribution.
  v_result := pg_temp.fb_reserve(c_op4, 5000);
  PERFORM pg_temp.fb_assert(v_result ->> 'status' = 'claimed', 'fourth reservation: ' || v_result::text);
  PERFORM pg_temp.fb_assert(piggyvest_primary.manage_savings(v_scope, c_op4::uuid, 'dispatch'), 'dispatch of the fourth failed');
  PERFORM pg_temp.fb_assert(
    piggyvest_primary.settle_savings(c_integration, 'staging', pg_temp.fb_proof(c_op4, 5000)) = 'confirmed',
    'a hold-free transfer was not settled');
  PERFORM pg_temp.fb_assert(
    piggyvest_primary.settle_savings(c_integration, 'staging', pg_temp.fb_proof(c_op4, 5000)) = 'duplicate',
    'settlement replay was not idempotent');
  PERFORM pg_temp.fb_assert(
    (SELECT current_amount FROM public.customer_savings_goals WHERE id = 'f3880000-0000-4000-8000-000000000005') = 50
    AND pg_temp.fb_state(c_op4) = 'confirmed', 'settlement did not credit the goal');
  PERFORM pg_temp.fb_assert(
    (SELECT pg_catalog.count(*) FROM public.customer_savings_contributions
      WHERE goal_id = 'f3880000-0000-4000-8000-000000000005' AND status = 'completed'
        AND wallet_transaction_id IS NULL AND amount = 50 AND idempotency_key = 'pvb-save-' || c_op4) = 1,
    'settlement wrote no hold-free contribution');
  PERFORM pg_temp.fb_assert(pg_temp.fb_legacy_untouched(), 'settlement changed the legacy wallet or its history');

  -- No local balance gate: with zero recorded receipts a large reservation is
  -- claimed (995000 kobo of capacity remain). One transfer per goal may be in
  -- flight (primary_savings_single_pending_goal_idx), so settle it before the next.
  v_result := pg_temp.fb_reserve(c_op5, 900000);
  PERFORM pg_temp.fb_assert(v_result ->> 'status' = 'claimed', 'a reservation was gated on a local balance: ' || v_result::text);
  PERFORM pg_temp.fb_assert(piggyvest_primary.manage_savings(v_scope, c_op5::uuid, 'dispatch'), 'dispatch of the fifth failed');
  PERFORM pg_temp.fb_assert(piggyvest_primary.settle_savings(c_integration, 'staging', pg_temp.fb_proof(c_op5, 900000)) = 'confirmed', 'large transfer not settled');
  v_result := pg_temp.fb_reserve(c_op6, 1);
  PERFORM pg_temp.fb_assert(v_result ->> 'status' = 'claimed', 'a settled outflow gated a later reservation on a local balance: ' || v_result::text);
  v_result := pg_temp.fb_reserve('f3880000-0000-4000-8000-0000000000a7', 95000);
  PERFORM pg_temp.fb_assert(v_result ->> 'status' = 'insufficient', 'open reservations did not consume goal capacity: ' || v_result::text);
  PERFORM pg_temp.fb_assert(pg_temp.fb_legacy_untouched(), 'the reservations changed the legacy wallet');

  -- Legacy path unchanged: no balance is still refused, and the refusal is the
  -- legacy wallet check (not any PiggyVest rule).
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  BEGIN
    PERFORM public.allocate_customer_savings_contribution(
      'f3880000-0000-4000-8000-000000000013'::uuid, 'f3880000-0000-4000-8000-000000000012'::uuid,
      'f3880000-0000-4000-8000-000000000002'::uuid, 10, 'wallet', NULL, 'fundbal-legacy-key', 'legacy');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'insufficient_wallet_balance' THEN RAISE; END IF;
    v_refused := true;
  END;
  PERFORM pg_temp.fb_assert(v_refused, 'a legacy customer with no balance was not refused with insufficient_wallet_balance');
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM pg_temp.fb_assert(
    (SELECT available_balance FROM public.customer_wallets WHERE id = 'f3880000-0000-4000-8000-000000000018') = 0
    AND NOT EXISTS (SELECT 1 FROM public.customer_wallet_transactions
                     WHERE customer_id = 'f3880000-0000-4000-8000-000000000012'),
    'the refused legacy contribution changed the legacy wallet');
END
$behaviour$;

-- Catalog: no legacy wallet use; grants stay closed (asserted via the catalog).
DO $catalog$
DECLARE v_role text; v_signature text;
BEGIN
  IF pg_catalog.pg_get_functiondef('piggyvest_primary.reserve_savings_before_interest(jsonb,jsonb)'::regprocedure)
     ~ 'customer_wallets|inflow_receipts' THEN
    RAISE EXCEPTION 'the funding reservation still uses the legacy wallet or the local receipt ledger';
  END IF;
  -- The login reaches reservation only via the PIN wrapper (20261103044600 revoked reserve_savings).
  IF pg_catalog.has_function_privilege('piggyvest_primary_authorizer',
       'piggyvest_primary.reserve_savings_before_interest(jsonb,jsonb)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('piggyvest_primary_authorizer',
       'piggyvest_primary.reserve_savings(jsonb,jsonb)'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('piggyvest_primary_authorizer',
       'piggyvest_primary.reserve_savings_with_pin(jsonb,jsonb,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'authorizer must hold only the PIN-gated wrapper, not the inner reservations';
  END IF;
  FOREACH v_signature IN ARRAY ARRAY[
    'piggyvest_primary.reserve_savings_before_interest(jsonb,jsonb)',
    'piggyvest_primary.manage_savings(jsonb,uuid,text)',
    'piggyvest_primary.release_failed_savings(uuid,text,jsonb)',
    'piggyvest_primary.settle_savings_before_completion(uuid,text,jsonb)'
  ] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_signature::regprocedure, 'EXECUTE') THEN
        RAISE EXCEPTION '% must not be executable by %', v_signature, v_role;
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS proc,
             pg_catalog.aclexplode(COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner))) AS acl
       WHERE proc.oid = v_signature::regprocedure AND acl.grantee = 0
    ) THEN
      RAISE EXCEPTION '% must not be executable by PUBLIC', v_signature;
    END IF;
  END LOOP;
END
$catalog$;

ROLLBACK;

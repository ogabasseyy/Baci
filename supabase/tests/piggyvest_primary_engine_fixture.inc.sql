-- Part of piggyvest_primary_engine_schema.sql (\ir): helpers and fixtures.
-- Runs inside the entry file's transaction; not a standalone suite.
--
-- One merchant with one PiggyVest integration, a customer with a verified
-- main wallet, a goal wallet, a second customer, the collection and interest
-- house wallets (the house-wallet part registers the fee wallet),
-- one bank destination per purpose and a customer wallet holding NGN 1,000.

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'engine suite: %', p_message; END IF;
END $$;

CREATE FUNCTION pg_temp.id(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('e5e00000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

-- Runs p_sql and returns its SQLSTATE, or 'ok' when it does not raise.
CREATE FUNCTION pg_temp.sqlstate_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;

CREATE FUNCTION pg_temp.error_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

CREATE FUNCTION pg_temp.balance(p_customer uuid) RETURNS numeric LANGUAGE sql AS $$
  SELECT available_balance FROM public.customer_wallets WHERE customer_id = p_customer
$$;

CREATE FUNCTION pg_temp.ledger_rows(p_customer uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.customer_wallet_transactions WHERE customer_id = p_customer
$$;

-- Inserts one transfer as the table owner. The kind's own roles are used
-- unless p_opts overrides them; wallet ids are left for the database to
-- resolve. Goal kinds get an exit claim id unless p_opts has "noClaim".
-- p_opts "integration" picks another integration than the fixture's.
CREATE FUNCTION pg_temp.wt(
  p_kind text, p_purpose text, p_mode text, p_ref text,
  p_state text DEFAULT 'ready', p_amount bigint DEFAULT 10000, p_opts jsonb DEFAULT '{}'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_kind piggyvest_primary.transfer_kinds%ROWTYPE;
  v_source text;
  v_destination text;
  v_id uuid;
BEGIN
  SELECT * INTO v_kind FROM piggyvest_primary.transfer_kinds WHERE kind = p_kind;
  v_source := COALESCE(p_opts->>'source', v_kind.source_role, 'main');
  v_destination := COALESCE(p_opts->>'destination', v_kind.destination_role, 'collection');
  INSERT INTO piggyvest_primary.wallet_transfers (
    integration_id, kind, source_role, destination_role, purpose, delivery_mode, source_ref,
    customer_id, goal_id, bank_destination_id, refund_of, exit_claim_id, amount_kobo, state)
  VALUES (
    COALESCE((p_opts->>'integration')::uuid, pg_temp.id(5)), p_kind, v_source, v_destination, p_purpose, p_mode, p_ref,
    CASE WHEN v_source IN ('main', 'goal') OR v_destination IN ('main', 'goal')
      THEN COALESCE((p_opts->>'customer')::uuid, pg_temp.id(3)) END,
    CASE WHEN v_source = 'goal' OR v_destination = 'goal' THEN pg_temp.id(21) END,
    CASE WHEN v_destination = 'bank'
      THEN CASE WHEN p_kind = 'treasury_sweep' THEN pg_temp.id(41) ELSE pg_temp.id(42) END END,
    (p_opts->>'refundOf')::uuid,
    CASE WHEN p_kind LIKE 'goal\_%' AND NOT p_opts ? 'noClaim' THEN pg_temp.id(900) END,
    p_amount, p_state)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Confirms a transfer the only way the guards allow: one attempt for the
-- outstanding amount, dispatched and confirmed with its proof. Returns the
-- attempt id.
CREATE FUNCTION pg_temp.confirm(p_transfer uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_attempt uuid;
  v_n int := (SELECT COALESCE(max(attempt), 0) + 1 FROM piggyvest_primary.wallet_transfer_attempts
    WHERE transfer_id = p_transfer);
BEGIN
  INSERT INTO piggyvest_primary.wallet_transfer_attempts(transfer_id, attempt, reference, amount_kobo)
    SELECT p_transfer, v_n, 'pvb-wt-' || p_transfer || '-' || v_n, outstanding_kobo
    FROM piggyvest_primary.wallet_transfers WHERE id = p_transfer
    RETURNING id INTO v_attempt;
  UPDATE piggyvest_primary.wallet_transfer_attempts SET state = 'dispatching' WHERE id = v_attempt;
  UPDATE piggyvest_primary.wallet_transfer_attempts SET state = 'confirmed', proof = '{"status":"successful"}',
    provider_transaction_id = 'pv-txn-' || v_attempt, fee_kobo = 0 WHERE id = v_attempt;
  UPDATE piggyvest_primary.wallet_transfers SET state = 'confirmed' WHERE id = p_transfer;
  RETURN v_attempt;
END $$;

-- The worker passes run as the transfer worker role. A suite login that
-- only administers that role (on the replay image it created the role but is
-- not a superuser) is given SET on it inside this transaction.
SELECT NOT pg_catalog.pg_has_role(current_user, 'piggyvest_primary_transfer_worker', 'SET')
  AS engine_suite_grant_worker \gset
\if :engine_suite_grant_worker
GRANT piggyvest_primary_transfer_worker TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
\endif

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES (pg_temp.id(1));
INSERT INTO public.merchants(id, email) VALUES
  (pg_temp.id(2), 'engine-schema@example.com'),
  (pg_temp.id(12), 'engine-schema-other@example.com');
INSERT INTO public.customers(id, merchant_id, user_id) VALUES
  (pg_temp.id(3), pg_temp.id(2), pg_temp.id(1)),
  (pg_temp.id(4), pg_temp.id(2), NULL),
  (pg_temp.id(13), pg_temp.id(12), NULL);
INSERT INTO public.products(id, merchant_id, name, price, status, stock_quantity) VALUES
  (pg_temp.id(20), pg_temp.id(2), 'Engine schema device', 100000, 'active', 3);
INSERT INTO public.customer_savings_goals(id, merchant_id, customer_id, product_id, title, status,
  source_mode, target_amount, current_amount, contribution_amount, contribution_frequency,
  start_date, maturity_date, terms_accepted_at, non_withdrawable_accepted_at)
VALUES (pg_temp.id(21), pg_temp.id(2), pg_temp.id(3), pg_temp.id(20), 'Engine goal', 'active',
  'manual', 100000, 0, 20000, 'daily', DATE '2026-10-01', DATE '2026-11-01',
  TIMESTAMPTZ '2026-10-01 00:00:00+00', TIMESTAMPTZ '2026-10-01 00:00:00+00');
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES (pg_temp.id(5), pg_temp.id(2), 'engine-business', 'staging', 'engine_fixture_executor', true);
INSERT INTO piggyvest_primary.onboarding_intents(id, integration_id, merchant_id, customer_id, user_id,
  request_fingerprint, state, provider_customer_id, provider_wallet_id)
  VALUES (pg_temp.id(6), pg_temp.id(5), pg_temp.id(2), pg_temp.id(3), pg_temp.id(1),
    repeat('e', 64), 'verified', 'pv-engine-customer', 'pv-engine-main');
INSERT INTO piggyvest_primary.savings_destinations(integration_id, goal_id, intent_id, provider_wallet_id, enabled)
  VALUES (pg_temp.id(5), pg_temp.id(21), pg_temp.id(6), 'pv-engine-goal', true);
INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id, currency, enabled,
  verified_at)
VALUES
  (pg_temp.id(5), 'collection', 'pv-house-collection', 'engine-business', 'NGN', true,
    TIMESTAMPTZ '2026-10-31 00:00:00+00'),
  (pg_temp.id(5), 'interest', 'pv-house-interest', 'engine-business', 'NGN', true, TIMESTAMPTZ '2026-10-31 00:00:00+00');
INSERT INTO piggyvest_primary.bank_destinations(id, integration_id, purpose, customer_id, bank_code,
  account_number, account_name, enabled, verified_at)
VALUES
  (pg_temp.id(41), pg_temp.id(5), 'treasury', NULL, '058', '0123456789', 'Ogabassey Treasury',
    true, TIMESTAMPTZ '2026-10-31 00:00:00+00'),
  (pg_temp.id(42), pg_temp.id(5), 'support_payout', pg_temp.id(3), '058', '0987654321', 'Engine Customer',
    true, TIMESTAMPTZ '2026-10-31 00:00:00+00');
INSERT INTO public.customer_wallets(id, customer_id, merchant_id, available_balance)
  VALUES (pg_temp.id(30), pg_temp.id(3), pg_temp.id(2), 1000.00);

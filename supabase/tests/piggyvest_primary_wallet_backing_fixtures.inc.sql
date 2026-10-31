-- Part of piggyvest_primary_wallet_backing.sql (\ir): ship-state checks and
-- fixtures. Runs inside the entry file's transaction; not a standalone suite.
--
-- Fixture customers (k -> scenario), all with an onboarding intent:
--   1 verified, wallet 1500.00 (clean move)    7 verified, wallet 900.00
--   2 verified, wallet 0.00                     8 verified, wallet 250.00 (never begun)
--   3 verified, no wallet row                   9 verified, wallet 400.00 (hook stub)
--   4 accepted only (unverified), wallet 500    10 verified but DVA closed, wallet 100
--   5 verified, wallet 700 + a pending row      11 verified, no wallet (zero flip)
--   6 merchant 2, verified, wallet 300          12 verified, wallet 600.00 (raising hook)

-- Ships dark: nothing is migrating or backed, so every existing wallet is
-- legacy before any fixture exists.
DO $$
BEGIN
  PERFORM pg_temp.check(
    (SELECT count(*) FROM piggyvest_primary.wallet_backing) = 0,
    'wallet_backing must ship empty');
  PERFORM pg_temp.check(
    (SELECT count(*) FROM piggyvest_primary.wallet_backing_events) = 0,
    'wallet_backing_events must ship empty');
  PERFORM pg_temp.check(NOT EXISTS (
    SELECT 1 FROM public.customer_wallets w
    WHERE piggyvest_primary.backing_state(w.customer_id, w.merchant_id) <> 'legacy'),
    'every existing wallet must be legacy');
END $$;

-- The merchant insert guards need a service_role claim, as in the other suites.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO auth.users(id)
SELECT pg_temp.id(100 + k) FROM generate_series(1, 12) AS k;

INSERT INTO public.merchants(id, email) VALUES
  (pg_temp.id(1), 'wallet-backing-m1@example.com'),
  (pg_temp.id(2), 'wallet-backing-m2@example.com');

INSERT INTO public.customers(id, merchant_id, user_id)
SELECT pg_temp.c(k), pg_temp.m(k), pg_temp.id(100 + k)
FROM generate_series(1, 12) AS k;

INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
VALUES
  (pg_temp.id(11), pg_temp.id(1), 'wallet-backing-business-1', 'staging', 'wallet_backing_fixture_m1', true),
  (pg_temp.id(12), pg_temp.id(2), 'wallet-backing-business-2', 'staging', 'wallet_backing_fixture_m2', true);

INSERT INTO piggyvest_primary.onboarding_intents(id, integration_id, merchant_id, customer_id, user_id,
  request_fingerprint, state, provider_customer_id, provider_wallet_id)
SELECT pg_temp.i(k), pg_temp.id(CASE WHEN k = 6 THEN 12 ELSE 11 END), pg_temp.m(k), pg_temp.c(k),
  pg_temp.id(100 + k), repeat(lpad(to_hex(k), 2, '0'), 32),
  CASE WHEN k = 4 THEN 'accepted' ELSE 'verified' END,
  'pv-backing-customer-' || k, 'pv-backing-wallet-' || k
FROM generate_series(1, 12) AS k;

-- Customer 10's provider account was attested closed after verification.
UPDATE piggyvest_primary.onboarding_intents
SET provider_closed_at = clock_timestamp()
WHERE id = pg_temp.i(10);

INSERT INTO public.customer_wallets(customer_id, merchant_id, available_balance, total_earned, total_redeemed)
SELECT pg_temp.c(v.k), pg_temp.m(v.k), v.balance, v.balance, 0
FROM (VALUES (1, 1500.00), (2, 0.00), (4, 500.00), (5, 700.00), (6, 300.00),
  (7, 900.00), (8, 250.00), (9, 400.00), (10, 100.00), (12, 600.00)) AS v(k, balance);

-- Customer 5 has a legacy savings transfer still pending.
INSERT INTO public.customer_wallet_transactions(wallet_id, customer_id, merchant_id, type, amount,
  balance_after, source_type, source_id, status, description)
SELECT w.id, w.customer_id, w.merchant_id, 'redemption', 100.00, 600.00,
  'piggyvest_primary_savings', pg_temp.id(500), 'pending', 'Savings transfer pending'
FROM public.customer_wallets w WHERE w.customer_id = pg_temp.c(5);

DO $$
BEGIN
  PERFORM pg_temp.check(NOT EXISTS (
    SELECT 1 FROM generate_series(1, 12) AS k WHERE pg_temp.state(k) <> 'legacy'),
    'fixture wallets must start legacy');
  PERFORM pg_temp.check(piggyvest_primary.is_backed(pg_temp.c(1), pg_temp.m(1)) = false,
    'a legacy wallet is not backed');
  PERFORM piggyvest_primary.assert_wallet_legacy(pg_temp.c(1), pg_temp.m(1));
  PERFORM pg_temp.expect_error(
    format('SELECT piggyvest_primary.backing_state(%L, NULL)', pg_temp.c(1)),
    '22023', 'wallet_backing_scope_required');
END $$;

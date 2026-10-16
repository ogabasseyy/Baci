-- REGRESSION TESTS (in-gate) via two live dblink sessions.
-- Auth: pass -v dblink_password=... for a non-default local DB (the
-- default is the supabase-local scratch password). dblink is dropped
-- at the end only if this file created it.

\set ON_ERROR_STOP on

\if :{?dblink_password}
\else
\set dblink_password postgres
\endif

SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'dblink') AS loyalty_had_dblink \gset

CREATE EXTENSION IF NOT EXISTS dblink;

SELECT dblink_connect('loyalty_enroll_race', format(
  'host=%s port=%s dbname=%s user=%s password=%s',
  inet_server_addr(), inet_server_port(), current_database(),
  current_user, :'dblink_password'));
SELECT dblink_connect('loyalty_award_race', format(
  'host=%s port=%s dbname=%s user=%s password=%s',
  inet_server_addr(), inet_server_port(), current_database(),
  current_user, :'dblink_password'));

-- Committed fixtures (own namespace; deleted at the end).
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES (
  '01bb0000-0000-4000-8000-000000000101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'race-user@example.com', 'test',
  now(), now(), now(), '{}', '{}'
);

-- merchants row before customers (FK), as service_role.
SET ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', false);
INSERT INTO public.merchants (id, email, business_name, slug)
VALUES (
  '01bb0000-0000-4000-8000-000000000001',
  'race-merchant@example.com',
  'Race Merchant',
  'race-merchant'
);
RESET ROLE;

DO $$
BEGIN
  INSERT INTO public.customers (id, merchant_id, email, user_id)
  VALUES (
    '01bb0000-0000-4000-8000-000000000011',
    '01bb0000-0000-4000-8000-000000000001',
    'race-member@example.com',
    '01bb0000-0000-4000-8000-000000000101'
  );

  INSERT INTO public.loyalty_settings (
    merchant_id, enabled, signup_bonus_points, referral_bonus_points,
    points_per_currency, points_currency_unit, points_expiry_days, tiers
  ) VALUES (
    '01bb0000-0000-4000-8000-000000000001', true, 50, 100,
    1, 100, 0, '[]'
  );
END;
$$;
RESET ROLE;

-- Session A: enroll and hold (uncommitted, advisory lock held).
SELECT dblink_exec('loyalty_enroll_race', 'BEGIN');
SELECT dblink_exec('loyalty_enroll_race', $jwt$DO $$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '01bb0000-0000-4000-8000-000000000101', false);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"sub":"01bb0000-0000-4000-8000-000000000101","role":"authenticated"}', false);
END;
$$;$jwt$);
DO $race$
DECLARE
  v_enroll jsonb;
BEGIN
  SELECT r INTO v_enroll FROM dblink(
    'loyalty_enroll_race',
    $$SELECT public.enroll_customer_loyalty('01bb0000-0000-4000-8000-000000000001', '01bb0000-0000-4000-8000-000000000011', NULL)$$
  ) AS result(r jsonb);
  IF v_enroll ->> 'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'setup enrollment failed: %', v_enroll;
  END IF;
END;
$race$;

-- Session B: first purchase while A holds the lock (autocommits).
SELECT dblink_send_query(
  'loyalty_award_race',
  $$SELECT public.award_purchase_points('01bb0000-0000-4000-8000-000000000011', '01bb0000-0000-4000-8000-000000000001', '01bb0000-0000-4000-8000-000000000201', 5000)$$
);

DO $$
DECLARE
  v_spins integer := 0;
BEGIN
  -- The award must block on the shared creation lock (not error, not
  -- slip through): still busy after 300ms proves serialization.
  WHILE dblink_is_busy('loyalty_award_race') = 0 AND v_spins < 6 LOOP
    PERFORM pg_sleep(0.05);
    v_spins := v_spins + 1;
  END LOOP;
  IF dblink_is_busy('loyalty_award_race') = 0 THEN
    RAISE EXCEPTION 'award did not block on the shared creation lock';
  END IF;
END;
$$;

-- Release A: B proceeds onto the enrolled row.
SELECT dblink_exec('loyalty_enroll_race', 'COMMIT');

DO $$
DECLARE
  v_spins integer := 0;
  v_points integer;
BEGIN
  WHILE dblink_is_busy('loyalty_award_race') = 1 AND v_spins < 200 LOOP
    PERFORM pg_sleep(0.05);
    v_spins := v_spins + 1;
  END LOOP;
  IF dblink_is_busy('loyalty_award_race') = 1 THEN
    RAISE EXCEPTION 'award never completed after enrollment committed';
  END IF;
  SELECT sum(points) INTO v_points
  FROM dblink_get_result('loyalty_award_race') AS result(points integer);
  IF v_points IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION 'expected a 50-point award, got %', v_points;
  END IF;
END;
$$;

-- A cancellation never waits on a retry-held claim row (SKIP LOCKED).
SET ROLE service_role;
INSERT INTO public.orders (id, merchant_id, order_number, customer_name, total)
VALUES ('01bb0000-0000-4000-8000-000000000009', '01bb0000-0000-4000-8000-000000000001', 'RACE-CANCEL-1', 'Race Cancel', 5000);
RESET ROLE;
INSERT INTO public.reward_redemptions (merchant_id, customer_id, points_spent, reward_type, discount_code, used, used_on_order_id, used_at)
VALUES ('01bb0000-0000-4000-8000-000000000001', '01bb0000-0000-4000-8000-000000000011', 100, 'discount_fixed', 'RDM-RACE1', true, '01bb0000-0000-4000-8000-000000000009', pg_catalog.now());
SELECT dblink_exec('loyalty_enroll_race', 'BEGIN');
SELECT * FROM dblink('loyalty_enroll_race',
  $$SELECT 1 FROM public.reward_redemptions WHERE discount_code = 'RDM-RACE1' FOR UPDATE$$) AS held(x integer);
SET ROLE service_role;
UPDATE public.orders SET shipping_status = 'cancelled'
WHERE id = '01bb0000-0000-4000-8000-000000000009';
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.reward_redemptions
    WHERE discount_code = 'RDM-RACE1' AND used IS TRUE
      AND used_on_order_id = '01bb0000-0000-4000-8000-000000000009'
  ) THEN
    RAISE EXCEPTION 'cancel waited on (or released) a retry-held claim';
  END IF;
END;
$$;
SELECT dblink_exec('loyalty_enroll_race', 'ROLLBACK');
DELETE FROM public.reward_redemptions WHERE discount_code = 'RDM-RACE1';
DELETE FROM public.orders WHERE id = '01bb0000-0000-4000-8000-000000000009';

-- Currency race: the mint stamp follows the payout-flip winner.
INSERT INTO public.loyalty_rewards (merchant_id, name, points_cost, reward_type, reward_value, enabled)
VALUES ('01bb0000-0000-4000-8000-000000000001', 'Currency race fixed', 10, 'discount_fixed', 500, true);
UPDATE public.loyalty_settings SET minimum_redemption_points = 0
WHERE merchant_id = '01bb0000-0000-4000-8000-000000000001';
SELECT dblink_connect(
  'loyalty_currency_race',
  format(
    'host=%s port=%s dbname=%s user=%s password=postgres',
    inet_server_addr(),
    inet_server_port(),
    current_database(),
    current_user
  )
);
SELECT dblink_exec('loyalty_currency_race', $jwt$DO $$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '01bb0000-0000-4000-8000-000000000101', false);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"sub":"01bb0000-0000-4000-8000-000000000101","role":"authenticated"}', false);
END;
$$;$jwt$);
SELECT dblink_exec('loyalty_enroll_race', 'BEGIN');
SELECT dblink_exec('loyalty_enroll_race', $$UPDATE public.merchants SET payout_currency = 'USD' WHERE id = '01bb0000-0000-4000-8000-000000000001'$$);
SELECT dblink_send_query('loyalty_currency_race', $$SELECT public.redeem_loyalty_reward('01bb0000-0000-4000-8000-000000000001', '01bb0000-0000-4000-8000-000000000011', (SELECT id FROM public.loyalty_rewards WHERE merchant_id = '01bb0000-0000-4000-8000-000000000001' AND name = 'Currency race fixed'))$$);
DO $$
DECLARE v_spins integer := 0;
BEGIN
  WHILE dblink_is_busy('loyalty_currency_race') = 0 AND v_spins < 6 LOOP
    PERFORM pg_sleep(0.05); v_spins := v_spins + 1;
  END LOOP;
  IF dblink_is_busy('loyalty_currency_race') = 0 THEN
    RAISE EXCEPTION 'redeem did not block on the merchant currency lock';
  END IF;
END;
$$;
SELECT dblink_exec('loyalty_enroll_race', 'COMMIT');
DO $$
DECLARE v_spins integer := 0; v_result jsonb;
BEGIN
  WHILE dblink_is_busy('loyalty_currency_race') = 1 AND v_spins < 200 LOOP
    PERFORM pg_sleep(0.05); v_spins := v_spins + 1;
  END LOOP;
  SELECT r INTO v_result FROM dblink_get_result('loyalty_currency_race') AS result(r jsonb);
  IF v_result ->> 'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'currency race redeem failed: %', v_result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reward_redemptions WHERE merchant_id = '01bb0000-0000-4000-8000-000000000001' AND issuance_currency = 'USD') THEN
    RAISE EXCEPTION 'mint did not stamp the post-flip currency';
  END IF;
END;
$$;
DELETE FROM public.reward_redemptions WHERE merchant_id = '01bb0000-0000-4000-8000-000000000001';
DELETE FROM public.loyalty_rewards WHERE merchant_id = '01bb0000-0000-4000-8000-000000000001' AND name = 'Currency race fixed';
DELETE FROM public.points_transactions WHERE merchant_id = '01bb0000-0000-4000-8000-000000000001' AND customer_id = '01bb0000-0000-4000-8000-000000000011' AND source = 'redemption';
UPDATE public.customer_loyalty SET points_balance = 100 WHERE merchant_id = '01bb0000-0000-4000-8000-000000000001' AND customer_id = '01bb0000-0000-4000-8000-000000000011';
SELECT dblink_disconnect('loyalty_currency_race');

SELECT dblink_disconnect('loyalty_enroll_race');
SELECT dblink_disconnect('loyalty_award_race');

-- Both credits landed exactly once (signup 50 + purchase 50).
DO $$
DECLARE
  v_rows integer;
  v_balance integer;
  v_lifetime integer;
  v_txns integer;
BEGIN
  SELECT count(*), min(points_balance), min(lifetime_points)
    INTO v_rows, v_balance, v_lifetime
  FROM public.customer_loyalty
  WHERE merchant_id = '01bb0000-0000-4000-8000-000000000001'
    AND customer_id = '01bb0000-0000-4000-8000-000000000011';
  IF v_rows IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expected one loyalty row, got %', v_rows;
  END IF;
  IF v_balance IS DISTINCT FROM 100 OR v_lifetime IS DISTINCT FROM 100 THEN
    RAISE EXCEPTION 'expected balance/lifetime 100/100, got %/%', v_balance, v_lifetime;
  END IF;
  SELECT count(*) INTO v_txns
  FROM public.points_transactions
  WHERE merchant_id = '01bb0000-0000-4000-8000-000000000001'
    AND customer_id = '01bb0000-0000-4000-8000-000000000011';
  IF v_txns IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'expected 2 ledger rows, got %', v_txns;
  END IF;
END;
$$;

-- Committed cleanup (mirror of setup, reverse dependency order).
DELETE FROM public.points_transactions WHERE merchant_id = '01bb0000-0000-4000-8000-000000000001' AND customer_id = '01bb0000-0000-4000-8000-000000000011';
DELETE FROM public.customer_loyalty WHERE merchant_id = '01bb0000-0000-4000-8000-000000000001' AND customer_id = '01bb0000-0000-4000-8000-000000000011';
DELETE FROM public.loyalty_settings WHERE merchant_id = '01bb0000-0000-4000-8000-000000000001';
DELETE FROM public.customers WHERE id = '01bb0000-0000-4000-8000-000000000011';
DELETE FROM public.merchants WHERE id = '01bb0000-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id = '01bb0000-0000-4000-8000-000000000101';

-- Restore the pre-test extension set (drop only what this file made).
\if :loyalty_had_dblink
\else
DROP EXTENSION IF EXISTS dblink;
\endif

-- Currency locked/gated pre-mint for currency-bound rewards: pin it.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef('public.redeem_loyalty_reward(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure) INTO v_def;
  IF v_def NOT LIKE '%FROM public.merchants WHERE id = p_merchant_id FOR UPDATE%'
     OR (SELECT count(*) FROM regexp_matches(v_def, 'merchant_resolves_to_ngn', 'g')) <> 1
     OR strpos(v_def, 'FROM public.merchants WHERE id = p_merchant_id FOR UPDATE') >= strpos(v_def, 'INSERT INTO public.reward_redemptions') THEN
    RAISE EXCEPTION 'redeem does not gate currency under lock before minting';
  END IF;
END;
$$;

-- The wrapper reuses claims stamped to cancelled orders: pin it.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef('public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::pg_catalog.regprocedure) INTO v_def;
  IF v_def NOT LIKE '%rr.used_on_order_id,%' OR v_def NOT LIKE '%loyalty_status_is_cancelled%'
     OR v_def NOT LIKE '%OR rr.used_on_order_id = v_redemption.used_on_order_id%' THEN
    RAISE EXCEPTION 'wrapper does not release claims stamped to cancelled orders';
  END IF;
END;
$$;

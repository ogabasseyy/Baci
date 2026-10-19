BEGIN;

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('f18a0000-0000-4000-8000-000000000001', 'pv-rls-a@example.invalid', '{}', '{}'),
  ('f18a0000-0000-4000-8000-000000000002', 'pv-rls-b@example.invalid', '{}', '{}');

SELECT set_config('request.jwt.claim.sub', 'f18a0000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"f18a0000-0000-4000-8000-000000000001","role":"authenticated"}', true);

INSERT INTO public.merchants (id, email, business_name, slug)
VALUES
  ('f18a0000-0000-4000-8000-000000000101', 'pv-rls-m1@example.invalid', 'PV RLS A', 'pv-rls-fixture-a'),
  ('f18a0000-0000-4000-8000-000000000102', 'pv-rls-m2@example.invalid', 'PV RLS B', 'pv-rls-fixture-b');

INSERT INTO public.customers (id, merchant_id, user_id, email)
VALUES
  ('f18a0000-0000-4000-8000-000000000201', 'f18a0000-0000-4000-8000-000000000101',
   'f18a0000-0000-4000-8000-000000000001', 'pv-rls-a@example.invalid'),
  ('f18a0000-0000-4000-8000-000000000202', 'f18a0000-0000-4000-8000-000000000101',
   'f18a0000-0000-4000-8000-000000000002', 'pv-rls-b@example.invalid');

INSERT INTO public.piggyvest_plan_wallets
  (customer_id, merchant_id, piggyvest_customer_id, wallet_id, subaccount_name, status)
VALUES
  ('f18a0000-0000-4000-8000-000000000201', 'f18a0000-0000-4000-8000-000000000101',
   'pv-rls-provider-a', 'pv-rls-wallet-a', 'PV RLS A', 'ready'),
  ('f18a0000-0000-4000-8000-000000000202', 'f18a0000-0000-4000-8000-000000000101',
   'pv-rls-provider-b', 'pv-rls-wallet-b', 'PV RLS B', 'ready'),
  ('f18a0000-0000-4000-8000-000000000201', 'f18a0000-0000-4000-8000-000000000102',
   'pv-rls-provider-a', 'pv-rls-wrong-merchant', 'PV RLS WRONG', 'ready');

INSERT INTO public.piggyvest_interest_payouts
  (provider_payout_id, event_id, customer_id, wallet_id, amount_kobo,
   gross_kobo, withholding_tax_kobo, net_kobo, reference, batch_id, paid_at)
SELECT fixture.payout, fixture.payout, fixture.customer, fixture.wallet,
  fixture.net, fixture.net, 0, fixture.net, fixture.payout, 'pv-rls-batch', now()
FROM (VALUES
  ('pv-rls-payout-a', 'pv-rls-provider-a', 'pv-rls-wallet-a', 11),
  ('pv-rls-payout-b', 'pv-rls-provider-b', 'pv-rls-wallet-b', 22),
  ('pv-rls-payout-merchant', 'pv-rls-provider-a', 'pv-rls-wrong-merchant', 33),
  ('pv-rls-payout-identity', 'pv-rls-provider-b', 'pv-rls-wallet-a', 44),
  ('pv-rls-payout-orphan', 'pv-rls-provider-a', 'pv-rls-orphan', 55)
) AS fixture(payout, customer, wallet, net);

DO $$
DECLARE
  target record;
  role_name text;
  privilege_name text;
  expected_select boolean;
BEGIN
  FOR target IN
    SELECT relation.relname, attribute.attname
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('piggyvest_plan_wallets', 'piggyvest_interest_payouts')
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
  LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      expected_select := role_name = 'authenticated' AND (
        (target.relname = 'piggyvest_plan_wallets' AND target.attname IN
          ('customer_id', 'merchant_id', 'piggyvest_customer_id', 'wallet_id', 'subaccount_name', 'status'))
        OR (target.relname = 'piggyvest_interest_payouts' AND target.attname IN
          ('net_kobo', 'wallet_id'))
      );
      IF has_column_privilege(role_name, 'public.' || target.relname, target.attname, 'SELECT')
        IS DISTINCT FROM expected_select THEN
        RAISE EXCEPTION 'unexpected SELECT grant: %.% for %',
          target.relname, target.attname, role_name;
      END IF;
      FOREACH privilege_name IN ARRAY ARRAY['INSERT', 'UPDATE', 'REFERENCES'] LOOP
        IF has_column_privilege(role_name, 'public.' || target.relname,
          target.attname, privilege_name) THEN
          RAISE EXCEPTION 'unexpected % grant: %.% for %',
            privilege_name, target.relname, target.attname, role_name;
        END IF;
      END LOOP;
      FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege(role_name, 'public.' || target.relname, privilege_name) THEN
          RAISE EXCEPTION 'unexpected table % grant: % for %',
            privilege_name, target.relname, role_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f18a0000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"f18a0000-0000-4000-8000-000000000001","role":"authenticated"}', true);

DO $$
DECLARE
  mapping_count integer;
  payout_total bigint;
BEGIN
  SELECT count(wallet_id) INTO mapping_count
  FROM public.piggyvest_plan_wallets WHERE wallet_id LIKE 'pv-rls-%';
  IF mapping_count <> 1 THEN
    RAISE EXCEPTION 'cross-user or cross-merchant mapping leaked: %', mapping_count;
  END IF;
  IF NOT EXISTS (
    SELECT piggyvest_customer_id, wallet_id, subaccount_name, status
    FROM public.piggyvest_plan_wallets
    WHERE customer_id = 'f18a0000-0000-4000-8000-000000000201'
      AND merchant_id = 'f18a0000-0000-4000-8000-000000000101'
      AND wallet_id = 'pv-rls-wallet-a' AND piggyvest_customer_id = 'pv-rls-provider-a'
      AND subaccount_name = 'PV RLS A' AND status = 'ready'
  ) THEN
    RAISE EXCEPTION 'own mapping projection unavailable';
  END IF;
  SELECT sum(net_kobo) INTO payout_total FROM public.piggyvest_interest_payouts
  WHERE wallet_id LIKE 'pv-rls-%';
  IF payout_total IS DISTINCT FROM 11::bigint THEN
    RAISE EXCEPTION 'payout ownership/provider identity failed: %', payout_total;
  END IF;
  SELECT sum(net_kobo) INTO payout_total FROM public.piggyvest_interest_payouts
  WHERE wallet_id = 'pv-rls-wallet-a';
  IF payout_total IS DISTINCT FROM 11::bigint THEN
    RAISE EXCEPTION 'wallet-filtered net projection failed';
  END IF;
END $$;

SELECT set_config('request.jwt.claim.sub', 'f18a0000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"f18a0000-0000-4000-8000-000000000002","role":"authenticated"}', true);

DO $$
BEGIN
  IF (SELECT array_agg(wallet_id) FROM public.piggyvest_plan_wallets
      WHERE wallet_id LIKE 'pv-rls-%') IS DISTINCT FROM ARRAY['pv-rls-wallet-b']::text[]
    OR (SELECT sum(net_kobo) FROM public.piggyvest_interest_payouts
      WHERE wallet_id LIKE 'pv-rls-%') IS DISTINCT FROM 22::bigint THEN
    RAISE EXCEPTION 'second user isolation failed';
  END IF;
END $$;

RESET ROLE;

DO $$
DECLARE
  role_name text;
  statement text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', role_name);
    FOREACH statement IN ARRAY ARRAY[
      'SELECT id FROM public.piggyvest_plan_wallets',
      'SELECT created_at FROM public.piggyvest_plan_wallets',
      'SELECT customer_id FROM public.piggyvest_interest_payouts',
      'SELECT event_id FROM public.piggyvest_interest_payouts',
      'INSERT INTO public.piggyvest_plan_wallets DEFAULT VALUES',
      'UPDATE public.piggyvest_plan_wallets SET status = status',
      'DELETE FROM public.piggyvest_plan_wallets',
      'INSERT INTO public.piggyvest_interest_payouts DEFAULT VALUES',
      'UPDATE public.piggyvest_interest_payouts SET net_kobo = net_kobo',
      'DELETE FROM public.piggyvest_interest_payouts'
    ] LOOP
      BEGIN
        EXECUTE statement;
        RAISE EXCEPTION 'statement unexpectedly allowed for %: %', role_name, statement;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END LOOP;
    IF role_name = 'anon' THEN
      FOREACH statement IN ARRAY ARRAY[
        'SELECT piggyvest_customer_id, wallet_id, subaccount_name, status FROM public.piggyvest_plan_wallets',
        'SELECT net_kobo, wallet_id FROM public.piggyvest_interest_payouts'
      ] LOOP
        BEGIN
          EXECUTE statement;
          RAISE EXCEPTION 'anonymous read unexpectedly allowed: %', statement;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
      END LOOP;
    END IF;
    RESET ROLE;
  END LOOP;
END $$;

ROLLBACK;

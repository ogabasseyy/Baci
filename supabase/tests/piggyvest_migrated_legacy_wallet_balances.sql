-- REGRESSION TEST (behaviour): the daily read of legacy wallets that were
-- moved to PiggyVest by hand (S10 runbook) and hold money again
-- (migration 20261121061500_piggyvest_migrated_legacy_wallet_balances).
-- Registered in replay-registry folder 20261121061500_piggyvest_migrated_legacy_wallet_balances.
--
-- Synthetic, transaction-local data; the session user stands in for the
-- reconciliation evidence login. Everything is rolled back.
\set ON_ERROR_STOP on
BEGIN;

UPDATE piggyvest_primary.integrations SET executor_login = 'retired-' || id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.inflow_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;

INSERT INTO auth.users (id, email) VALUES
  ('f9b20000-0000-4000-8000-000000000001', 'piggyvest-migrated-a@example.test'),
  ('f9b20000-0000-4000-8000-000000000011', 'piggyvest-migrated-b@example.test');
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f9b20000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f9b20000-0000-4000-8000-000000000002', 'f9b20000-0000-4000-8000-000000000001',
   'piggyvest-migrated-a@example.test', 'Migrated Wallet Fixture A', 'piggyvest-migrated-fixture-a');
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f9b20000-0000-4000-8000-000000000011', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f9b20000-0000-4000-8000-000000000012', 'f9b20000-0000-4000-8000-000000000011',
   'piggyvest-migrated-b@example.test', 'Migrated Wallet Fixture B', 'piggyvest-migrated-fixture-b');
SELECT set_config('request.jwt.claims', '{}', true);

-- Five customers of merchant A, one of merchant B (one wallet per customer).
INSERT INTO public.customers (id, merchant_id, email) VALUES
  ('f9b20000-0000-4000-8000-0000000000a1', 'f9b20000-0000-4000-8000-000000000002', 'moved-refilled@example.test'),
  ('f9b20000-0000-4000-8000-0000000000a2', 'f9b20000-0000-4000-8000-000000000002', 'moved-empty@example.test'),
  ('f9b20000-0000-4000-8000-0000000000a3', 'f9b20000-0000-4000-8000-000000000002', 'never-moved@example.test'),
  ('f9b20000-0000-4000-8000-0000000000a4', 'f9b20000-0000-4000-8000-000000000002', 'moved-refilled-2@example.test'),
  ('f9b20000-0000-4000-8000-0000000000a5', 'f9b20000-0000-4000-8000-000000000002', 'mis-attributed@example.test'),
  ('f9b20000-0000-4000-8000-0000000000b1', 'f9b20000-0000-4000-8000-000000000012', 'other-merchant@example.test');

INSERT INTO public.customer_wallets (id, customer_id, merchant_id, available_balance) VALUES
  -- Moved, then a late credit landed: listed.
  ('f9b20000-0000-4000-8000-0000000000c1', 'f9b20000-0000-4000-8000-0000000000a1',
   'f9b20000-0000-4000-8000-000000000002', 500.00),
  -- Moved and still empty: not listed.
  ('f9b20000-0000-4000-8000-0000000000c2', 'f9b20000-0000-4000-8000-0000000000a2',
   'f9b20000-0000-4000-8000-000000000002', 0.00),
  -- Never moved, holds money: not this alert's business.
  ('f9b20000-0000-4000-8000-0000000000c3', 'f9b20000-0000-4000-8000-0000000000a3',
   'f9b20000-0000-4000-8000-000000000002', 900.00),
  -- Moved, then refilled with more: listed first (largest first).
  ('f9b20000-0000-4000-8000-0000000000c4', 'f9b20000-0000-4000-8000-0000000000a4',
   'f9b20000-0000-4000-8000-000000000002', 1250.50),
  -- Another merchant's moved-and-refilled wallet: never listed.
  ('f9b20000-0000-4000-8000-0000000000d1', 'f9b20000-0000-4000-8000-0000000000b1',
   'f9b20000-0000-4000-8000-000000000012', 700.00);

-- The migration ledger rows 02-zero-out.sql writes.
INSERT INTO public.customer_wallet_transactions (
  wallet_id, customer_id, merchant_id, type, amount, balance_after, source_type, status, description
)
SELECT wallet.id, wallet.customer_id, wallet.merchant_id, 'debit', 100.00, 0,
       'piggyvest_legacy_migration', 'completed', 'Moved to PiggyVest wallet (manual credit)'
  FROM public.customer_wallets AS wallet
 WHERE wallet.id IN ('f9b20000-0000-4000-8000-0000000000c1', 'f9b20000-0000-4000-8000-0000000000c2',
                     'f9b20000-0000-4000-8000-0000000000c4', 'f9b20000-0000-4000-8000-0000000000d1');

INSERT INTO piggyvest_primary.integrations
  (id, merchant_id, business_id, environment, executor_login, enabled)
VALUES ('f9b20000-0000-4000-8000-000000000006', 'f9b20000-0000-4000-8000-000000000002',
  'synthetic-migrated-business', 'staging', SESSION_USER, true);
INSERT INTO piggyvest_primary.inflow_authorities (integration_id, executor_login, enabled)
VALUES ('f9b20000-0000-4000-8000-000000000006', SESSION_USER, true);

-- A mis-attributed migration row (another merchant) on a merchant A wallet
-- that holds money must not flag it.
INSERT INTO public.customer_wallets (id, customer_id, merchant_id, available_balance) VALUES
  ('f9b20000-0000-4000-8000-0000000000c5', 'f9b20000-0000-4000-8000-0000000000a5',
   'f9b20000-0000-4000-8000-000000000002', 42.00);
INSERT INTO public.customer_wallet_transactions (
  wallet_id, customer_id, merchant_id, type, amount, balance_after, source_type, status
) VALUES ('f9b20000-0000-4000-8000-0000000000c5', 'f9b20000-0000-4000-8000-0000000000a5',
  'f9b20000-0000-4000-8000-000000000012', 'debit', 1.00, 0, 'piggyvest_legacy_migration', 'completed');

DO $behaviour$
DECLARE
  c_integration constant uuid := 'f9b20000-0000-4000-8000-000000000006';
  v_result jsonb;
BEGIN
  -- 1. Only this merchant's moved wallets that hold money, largest first.
  v_result := piggyvest_primary.read_migrated_legacy_wallet_balances(c_integration, 'staging', '{}');
  IF (v_result ->> 'count')::int <> 2
     OR v_result ->> 'totalBalance' <> '1750.50'
     OR pg_catalog.jsonb_array_length(v_result -> 'wallets') <> 2
     OR v_result -> 'wallets' -> 0 ->> 'walletId' <> 'f9b20000-0000-4000-8000-0000000000c4'
     OR v_result -> 'wallets' -> 0 ->> 'balance' <> '1250.50'
     OR v_result -> 'wallets' -> 1 ->> 'walletId' <> 'f9b20000-0000-4000-8000-0000000000c1' THEN
    RAISE EXCEPTION 'migrated wallet read: unexpected result %', v_result;
  END IF;

  -- 2. No personal data in the answer.
  IF v_result::text ~* '(@example\.test|full_name|email|phone)' THEN
    RAISE EXCEPTION 'migrated wallet read leaked personal data: %', v_result;
  END IF;

  -- 3. Nothing flagged: an empty list, never null.
  UPDATE public.customer_wallets SET available_balance = 0
   WHERE id IN ('f9b20000-0000-4000-8000-0000000000c1', 'f9b20000-0000-4000-8000-0000000000c4');
  v_result := piggyvest_primary.read_migrated_legacy_wallet_balances(c_integration, 'staging', '{}');
  IF (v_result ->> 'count')::int <> 0 OR v_result ->> 'totalBalance' <> '0.00'
     OR v_result -> 'wallets' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'migrated wallet read with nothing flagged: %', v_result;
  END IF;

  -- 4. A wrong environment, or a disabled authority, is refused.
  BEGIN
    PERFORM piggyvest_primary.read_migrated_legacy_wallet_balances(c_integration, 'production', '{}');
    RAISE EXCEPTION 'a mismatched environment was read';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  UPDATE piggyvest_primary.inflow_authorities SET enabled = false WHERE integration_id = c_integration;
  BEGIN
    PERFORM piggyvest_primary.read_migrated_legacy_wallet_balances(c_integration, 'staging', '{}');
    RAISE EXCEPTION 'a disabled authority was read';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END;
$behaviour$;

-- 5. Only the evidence login may call it (catalog, not call-and-catch).
DO $grants$
DECLARE
  c_fn constant text := 'piggyvest_primary.read_migrated_legacy_wallet_balances(uuid,text,jsonb)';
BEGIN
  IF pg_catalog.has_function_privilege('anon', c_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', c_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', c_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('piggyvest_primary_authorizer', c_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'migrated wallet read is executable beyond the evidence login';
  END IF;
  IF NOT pg_catalog.has_function_privilege('piggyvest_primary_evidence', c_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'the evidence login cannot run the migrated wallet read';
  END IF;
  IF NOT (SELECT proc.prosecdef FROM pg_catalog.pg_proc AS proc WHERE proc.oid = c_fn::regprocedure) THEN
    RAISE EXCEPTION 'migrated wallet read must be SECURITY DEFINER';
  END IF;
END;
$grants$;

ROLLBACK;

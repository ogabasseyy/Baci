-- =============================================
-- REGRESSION TEST: PiggyVest plan wallets
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/piggyvest_plan_wallets.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.piggyvest_plan_wallets') IS NULL THEN
    RAISE EXCEPTION 'public.piggyvest_plan_wallets table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_plan_wallets'
      AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'piggyvest_plan_wallets RLS not enabled';
  END IF;

  IF (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_plan_wallets'
  ) <> 1 OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_plan_wallets'
      AND policyname = 'customer_reads_own_piggyvest_plan_wallet'
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND permissive = 'PERMISSIVE'
      AND with_check IS NULL
  ) THEN
    RAISE EXCEPTION 'piggyvest_plan_wallets must have exactly the authenticated scoped read policy';
  END IF;
END $$;

-- One wallet per (customer, merchant): concurrent ensures collapse.
INSERT INTO public.piggyvest_plan_wallets
  (customer_id, merchant_id, piggyvest_customer_id, wallet_id, subaccount_name)
VALUES
  ('c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
   'pvb-customer-synthetic-001', 'pvb-wallet-synthetic-001', 'BACI PLAN SYNTHETIC 001')
ON CONFLICT (customer_id, merchant_id) DO NOTHING;

INSERT INTO public.piggyvest_plan_wallets
  (customer_id, merchant_id, piggyvest_customer_id, wallet_id, subaccount_name)
VALUES
  ('c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
   'pvb-customer-synthetic-001', 'pvb-wallet-synthetic-002', 'BACI PLAN SYNTHETIC 002')
ON CONFLICT (customer_id, merchant_id) DO NOTHING;

DO $$
DECLARE
  row_count integer;
  kept_wallet text;
BEGIN
  SELECT COUNT(*), MIN(wallet_id) INTO row_count, kept_wallet
  FROM public.piggyvest_plan_wallets
  WHERE customer_id = 'c0065070-dc32-45d2-9c01-871a27abfd10';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'duplicate plan wallet was not collapsed, count=%', row_count;
  END IF;
  IF kept_wallet <> 'pvb-wallet-synthetic-001' THEN
    RAISE EXCEPTION 'first wallet did not win, kept=%', kept_wallet;
  END IF;
END $$;

-- Default status is provisioning.
DO $$
DECLARE
  row_status text;
BEGIN
  SELECT status INTO row_status
  FROM public.piggyvest_plan_wallets
  WHERE wallet_id = 'pvb-wallet-synthetic-001';
  IF row_status <> 'provisioning' THEN
    RAISE EXCEPTION 'unexpected default status=%', row_status;
  END IF;
END $$;

-- Restricted is a legal transition target for the webhook processor slice.
UPDATE public.piggyvest_plan_wallets
SET status = 'restricted', updated_at = now()
WHERE wallet_id = 'pvb-wallet-synthetic-001';

DO $$
DECLARE
  row_status text;
BEGIN
  SELECT status INTO row_status
  FROM public.piggyvest_plan_wallets
  WHERE wallet_id = 'pvb-wallet-synthetic-001';
  IF row_status <> 'restricted' THEN
    RAISE EXCEPTION 'restriction transition failed, status=%', row_status;
  END IF;
END $$;

ROLLBACK;

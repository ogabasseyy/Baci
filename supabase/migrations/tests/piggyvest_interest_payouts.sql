-- =============================================
-- REGRESSION TEST: PiggyVest interest payouts
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/piggyvest_interest_payouts.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.piggyvest_interest_payouts') IS NULL THEN
    RAISE EXCEPTION 'public.piggyvest_interest_payouts table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_interest_payouts'
      AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'piggyvest_interest_payouts RLS not enabled';
  END IF;

  IF (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_interest_payouts'
  ) <> 1 OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_interest_payouts'
      AND policyname = 'customer_reads_own_piggyvest_interest_payouts'
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND permissive = 'PERMISSIVE'
      AND with_check IS NULL
  ) THEN
    RAISE EXCEPTION 'piggyvest_interest_payouts must have exactly the authenticated scoped read policy';
  END IF;
END $$;

-- A consistent payout inserts once; redelivery collapses on provider id.
INSERT INTO public.piggyvest_interest_payouts
  (provider_payout_id, event_id, customer_id, wallet_id, amount_kobo,
   gross_kobo, withholding_tax_kobo, net_kobo, reference, batch_id, paid_at)
VALUES
  ('payout-synthetic-001', 'evt-synthetic-001', 'cust-synthetic-001',
   'wallet-synthetic-001', 95000, 100000, 5000, 95000,
   'ref-synthetic-001', 'batch-synthetic-001', now())
ON CONFLICT (provider_payout_id) DO NOTHING;

INSERT INTO public.piggyvest_interest_payouts
  (provider_payout_id, event_id, customer_id, wallet_id, amount_kobo,
   gross_kobo, withholding_tax_kobo, net_kobo, reference, batch_id, paid_at)
VALUES
  ('payout-synthetic-001', 'evt-synthetic-002', 'cust-synthetic-001',
   'wallet-synthetic-001', 95000, 100000, 5000, 95000,
   'ref-synthetic-001', 'batch-synthetic-001', now())
ON CONFLICT (provider_payout_id) DO NOTHING;

DO $$
DECLARE
  row_count integer;
BEGIN
  SELECT COUNT(*) INTO row_count
  FROM public.piggyvest_interest_payouts
  WHERE provider_payout_id = 'payout-synthetic-001';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'duplicate payout was not collapsed, count=%', row_count;
  END IF;
END $$;

-- Inconsistent arithmetic is rejected even if the app check is bypassed.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.piggyvest_interest_payouts
      (provider_payout_id, event_id, customer_id, wallet_id, amount_kobo,
       gross_kobo, withholding_tax_kobo, net_kobo, reference, batch_id, paid_at)
    VALUES
      ('payout-synthetic-bad', 'evt-synthetic-003', 'cust-synthetic-001',
       'wallet-synthetic-001', 95000, 100000, 4000, 95000,
       'ref-synthetic-002', 'batch-synthetic-001', now());
    RAISE EXCEPTION 'inconsistent payout arithmetic was accepted';
  EXCEPTION WHEN check_violation THEN
    -- Expected: gross - tax must equal net.
    NULL;
  END;
END $$;

ROLLBACK;

-- =============================================
-- REGRESSION TEST: PiggyVest inflow credits
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/piggyvest_inflow_credits.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.piggyvest_inflow_credits') IS NULL THEN
    RAISE EXCEPTION 'public.piggyvest_inflow_credits table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_inflow_credits'
      AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'piggyvest_inflow_credits RLS not enabled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_inflow_credits'
  ) THEN
    RAISE EXCEPTION 'piggyvest_inflow_credits must have no policies (service-role only)';
  END IF;

  -- Sender PII must never gain a column here.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'piggyvest_inflow_credits'
      AND column_name IN (
        'sender_name', 'sender_bank_account_number',
        'recipient_bank_account_number', 'recipient_bank_account_name'
      )
  ) THEN
    RAISE EXCEPTION 'piggyvest_inflow_credits stores sender PII';
  END IF;
END $$;

-- A confirmed inflow inserts once; redelivery collapses on transaction id.
INSERT INTO public.piggyvest_inflow_credits
  (provider_transaction_id, event_data_id, event_id, customer_id, wallet_id,
   amount_kobo, fee_kobo, reference, session_id, credited_at)
VALUES
  ('provider-txn-synthetic-001', 'faas-txn-synthetic-001', 'evt-synthetic-001',
   'cust-synthetic-001', 'wallet-synthetic-001', 1750000, 0,
   'ref-synthetic-001', 'session-synthetic-001', now())
ON CONFLICT (provider_transaction_id) DO NOTHING;

INSERT INTO public.piggyvest_inflow_credits
  (provider_transaction_id, event_data_id, event_id, customer_id, wallet_id,
   amount_kobo, fee_kobo, reference, session_id, credited_at)
VALUES
  ('provider-txn-synthetic-001', 'faas-txn-synthetic-001', 'evt-synthetic-002',
   'cust-synthetic-001', 'wallet-synthetic-001', 1750000, 0,
   'ref-synthetic-001', 'session-synthetic-001', now())
ON CONFLICT (provider_transaction_id) DO NOTHING;

DO $$
DECLARE
  row_count integer;
BEGIN
  SELECT COUNT(*) INTO row_count
  FROM public.piggyvest_inflow_credits
  WHERE provider_transaction_id = 'provider-txn-synthetic-001';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'duplicate inflow was not collapsed, count=%', row_count;
  END IF;
END $$;

-- Zero-amount inflows are rejected even if the app check is bypassed.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.piggyvest_inflow_credits
      (provider_transaction_id, event_data_id, event_id, customer_id, wallet_id,
       amount_kobo, fee_kobo, reference, session_id, credited_at)
    VALUES
      ('provider-txn-synthetic-zero', 'faas-txn-synthetic-002', 'evt-synthetic-003',
       'cust-synthetic-001', 'wallet-synthetic-001', 0, 0,
       'ref-synthetic-002', 'session-synthetic-002', now());
    RAISE EXCEPTION 'zero-amount inflow was accepted';
  EXCEPTION WHEN check_violation THEN
    -- Expected: amount must be positive.
    NULL;
  END;
END $$;

ROLLBACK;

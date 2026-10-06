-- =============================================
-- REGRESSION TEST: PiggyVest webhook inbox
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/piggyvest_webhook_inbox.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.piggyvest_webhook_inbox') IS NULL THEN
    RAISE EXCEPTION 'public.piggyvest_webhook_inbox table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'piggyvest_webhook_inbox'
      AND i.indisprimary
  ) THEN
    RAISE EXCEPTION 'piggyvest_webhook_inbox primary key missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_webhook_inbox'
      AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'piggyvest_webhook_inbox RLS not enabled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_webhook_inbox'
  ) THEN
    RAISE EXCEPTION 'piggyvest_webhook_inbox must have no policies (service-role only)';
  END IF;
END $$;

-- Duplicate deliveries collapse on event_id.
INSERT INTO public.piggyvest_webhook_inbox
  (event_id, event_type, event_category, customer_id, wallet_id, reference, amount_kobo)
VALUES
  ('evt-test-001', 'bank-transfer.inflow.success', 'bank-transfer', 'cust-test-001', 'wallet-test-001', 'ref-test-001', 1750000)
ON CONFLICT DO NOTHING;

INSERT INTO public.piggyvest_webhook_inbox
  (event_id, event_type, event_category, customer_id, wallet_id, reference, amount_kobo)
VALUES
  ('evt-test-001', 'bank-transfer.inflow.success', 'bank-transfer', 'cust-test-001', 'wallet-test-001', 'ref-test-001', 1750000)
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  row_count integer;
BEGIN
  SELECT COUNT(*) INTO row_count
  FROM public.piggyvest_webhook_inbox
  WHERE event_id = 'evt-test-001';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'duplicate event_id was not collapsed, count=%', row_count;
  END IF;
END $$;

-- Atomic claim: exactly one worker wins a pending row.
WITH claimed AS (
  UPDATE public.piggyvest_webhook_inbox
  SET status = 'processing', attempts = attempts + 1, updated_at = now()
  WHERE event_id = 'evt-test-001' AND status = 'pending'
  RETURNING event_id
)
SELECT * FROM claimed;

DO $$
DECLARE
  row_status text;
BEGIN
  SELECT status INTO row_status
  FROM public.piggyvest_webhook_inbox
  WHERE event_id = 'evt-test-001';
  IF row_status <> 'processing' THEN
    RAISE EXCEPTION 'claim did not transition to processing, status=%', row_status;
  END IF;
END $$;

-- A second claim attempt must not re-win the same row.
DO $$
DECLARE
  wins integer;
BEGIN
  WITH claimed AS (
    UPDATE public.piggyvest_webhook_inbox
    SET status = 'processing', attempts = attempts + 1, updated_at = now()
    WHERE event_id = 'evt-test-001' AND status = 'pending'
    RETURNING event_id
  )
  SELECT COUNT(*) INTO wins FROM claimed;
  IF wins <> 0 THEN
    RAISE EXCEPTION 'second claim unexpectedly won the row';
  END IF;
END $$;

ROLLBACK;

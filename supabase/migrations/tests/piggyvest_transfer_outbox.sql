-- =============================================
-- REGRESSION TEST: PiggyVest transfer outbox
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/piggyvest_transfer_outbox.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.piggyvest_transfer_outbox') IS NULL THEN
    RAISE EXCEPTION 'public.piggyvest_transfer_outbox table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_transfer_outbox'
      AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'piggyvest_transfer_outbox RLS not enabled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_transfer_outbox'
  ) THEN
    RAISE EXCEPTION 'piggyvest_transfer_outbox must have no policies (service-role only)';
  END IF;
END $$;

-- Duplicate submissions collapse on our reference.
INSERT INTO public.piggyvest_transfer_outbox
  (reference, customer_id, merchant_id, wallet_id, amount_kobo,
   direction, destination_ref)
VALUES
  ('ref-synthetic-001', 'c0065070-dc32-45d2-9c01-871a27abfd10',
   '43e157b6-179c-432a-9392-e0827da96d82', 'wallet-synthetic-001', 500000,
   'bank', '058:6789')
ON CONFLICT (reference) DO NOTHING;

INSERT INTO public.piggyvest_transfer_outbox
  (reference, customer_id, merchant_id, wallet_id, amount_kobo,
   direction, destination_ref)
VALUES
  ('ref-synthetic-001', 'c0065070-dc32-45d2-9c01-871a27abfd10',
   '43e157b6-179c-432a-9392-e0827da96d82', 'wallet-synthetic-001', 500000,
   'bank', '058:6789')
ON CONFLICT (reference) DO NOTHING;

DO $$
DECLARE
  row_count integer;
BEGIN
  SELECT COUNT(*) INTO row_count
  FROM public.piggyvest_transfer_outbox
  WHERE reference = 'ref-synthetic-001';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'duplicate submission was not collapsed, count=%', row_count;
  END IF;
END $$;

-- First terminal state wins; a conflicting late arrival cannot overwrite it.
UPDATE public.piggyvest_transfer_outbox
SET status = 'succeeded', updated_at = now()
WHERE reference = 'ref-synthetic-001' AND status = 'submitted';

DO $$
DECLARE
  wins integer;
BEGIN
  WITH flipped AS (
    UPDATE public.piggyvest_transfer_outbox
    SET status = 'failed', updated_at = now()
    WHERE reference = 'ref-synthetic-001' AND status = 'submitted'
    RETURNING reference
  )
  SELECT COUNT(*) INTO wins FROM flipped;
  IF wins <> 0 THEN
    RAISE EXCEPTION 'conflicting terminal state overwrote succeeded';
  END IF;
END $$;

DO $$
DECLARE
  row_status text;
BEGIN
  SELECT status INTO row_status
  FROM public.piggyvest_transfer_outbox
  WHERE reference = 'ref-synthetic-001';
  IF row_status <> 'succeeded' THEN
    RAISE EXCEPTION 'unexpected terminal status=%', row_status;
  END IF;
END $$;

ROLLBACK;

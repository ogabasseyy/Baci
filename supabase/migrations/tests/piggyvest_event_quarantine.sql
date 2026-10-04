-- =============================================
-- REGRESSION TEST: PiggyVest event quarantine
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/piggyvest_event_quarantine.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.piggyvest_event_quarantine') IS NULL THEN
    RAISE EXCEPTION 'public.piggyvest_event_quarantine table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'piggyvest_event_quarantine'
      AND i.indisprimary
  ) THEN
    RAISE EXCEPTION 'piggyvest_event_quarantine primary key missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_event_quarantine'
      AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'piggyvest_event_quarantine RLS not enabled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_event_quarantine'
  ) THEN
    RAISE EXCEPTION 'piggyvest_event_quarantine must have no policies (service-role only)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'piggyvest_event_quarantine_digest_key'
  ) THEN
    RAISE EXCEPTION 'piggyvest_event_quarantine body_digest unique key missing';
  END IF;

  IF NOT has_column_privilege('service_role', 'public.piggyvest_event_quarantine', 'detail', 'INSERT')
    OR NOT has_column_privilege('service_role', 'public.piggyvest_event_quarantine', 'resolved_at', 'UPDATE') THEN
    RAISE EXCEPTION 'piggyvest_event_quarantine grants are not service-role intake/review';
  END IF;
  IF has_table_privilege('service_role', 'public.piggyvest_event_quarantine', 'DELETE')
    OR has_table_privilege('service_role', 'public.piggyvest_event_quarantine', 'TRUNCATE')
    OR has_table_privilege('anon', 'public.piggyvest_event_quarantine', 'SELECT') THEN
    RAISE EXCEPTION 'piggyvest_event_quarantine grants exceed required permissions';
  END IF;
END $$;

-- Identical redeliveries collapse on the body digest.
INSERT INTO public.piggyvest_event_quarantine
  (event_id, event_type, body_digest, reason, detail)
VALUES
  ('evt-test-001', 'wallet.transfer.success', repeat('a', 64), 'unknown-event', NULL)
ON CONFLICT (body_digest) DO NOTHING;

INSERT INTO public.piggyvest_event_quarantine
  (event_id, event_type, body_digest, reason, detail)
VALUES
  ('evt-test-001', 'wallet.transfer.success', repeat('a', 64), 'unknown-event', NULL)
ON CONFLICT (body_digest) DO NOTHING;

DO $$
DECLARE
  row_count integer;
BEGIN
  SELECT COUNT(*) INTO row_count
  FROM public.piggyvest_event_quarantine
  WHERE body_digest = repeat('a', 64);
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'duplicate body_digest was not collapsed, count=%', row_count;
  END IF;
END $$;

-- Reason is constrained to the reviewed set.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.piggyvest_event_quarantine
      (body_digest, reason)
    VALUES
      (repeat('b', 64), 'not-a-reason');
    RAISE EXCEPTION 'quarantine accepted an unknown reason';
  EXCEPTION WHEN check_violation THEN
    -- expected
  END;
END $$;

-- Resolution lifecycle columns accept a manual review.
UPDATE public.piggyvest_event_quarantine
SET resolved_at = now(), resolution = 'reviewed in test'
WHERE body_digest = repeat('a', 64);

DO $$
DECLARE
  row_resolution text;
BEGIN
  SELECT resolution INTO row_resolution
  FROM public.piggyvest_event_quarantine
  WHERE body_digest = repeat('a', 64);
  IF row_resolution <> 'reviewed in test' THEN
    RAISE EXCEPTION 'quarantine resolution was not recorded';
  END IF;
END $$;

ROLLBACK;

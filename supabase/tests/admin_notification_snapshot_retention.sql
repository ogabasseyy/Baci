-- REGRESSION TEST: terminal notification finalization prunes claim snapshots,
-- while retryable finalization retains the active snapshot.
-- Run in an isolated PostgreSQL database with psql -X -v ON_ERROR_STOP=1.

BEGIN;

CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;

CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT 'service_role';
$$;

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY,
  delivery_state text NOT NULL,
  sent_at timestamptz,
  delivery_claimed_at timestamptz,
  delivery_claim_token uuid,
  delivery_attempts integer NOT NULL DEFAULT 0,
  delivery_failed_at timestamptz,
  delivery_last_error text,
  scheduled_for timestamptz NOT NULL
);
CREATE TABLE public.merchant_notifications (
  notification_id uuid NOT NULL,
  read_at timestamptz
);
CREATE TABLE public.admin_notification_audience_snapshot (
  notification_id uuid NOT NULL,
  claim_token uuid NOT NULL,
  merchant_id uuid NOT NULL,
  PRIMARY KEY (notification_id, claim_token, merchant_id)
);

INSERT INTO public.notifications (
  id, delivery_state, delivery_claim_token, delivery_attempts, scheduled_for
) VALUES
  ('00000000-0000-0000-0000-000000000001', 'processing', '00000000-0000-0000-0000-000000000011', 1, clock_timestamp()),
  ('00000000-0000-0000-0000-000000000002', 'processing', '00000000-0000-0000-0000-000000000012', 3, clock_timestamp()),
  ('00000000-0000-0000-0000-000000000003', 'processing', '00000000-0000-0000-0000-000000000013', 1, clock_timestamp()),
  ('00000000-0000-0000-0000-000000000004', 'processing', '00000000-0000-0000-0000-000000000014', 1, clock_timestamp());
INSERT INTO public.admin_notification_audience_snapshot (notification_id, claim_token, merchant_id)
VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000004');

\ir ../migrations/20260811150001_prune_terminal_notification_audience_snapshots.sql

DO $$
DECLARE
  v_remaining integer;
BEGIN
  IF NOT public.finalize_scheduled_admin_notification_v1(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000011', 'retry', NULL
  ) THEN RAISE EXCEPTION 'retryable finalization was not applied'; END IF;
  SELECT COUNT(*) INTO v_remaining FROM public.admin_notification_audience_snapshot
    WHERE notification_id = '00000000-0000-0000-0000-000000000001';
  IF v_remaining <> 1 THEN RAISE EXCEPTION 'retryable snapshot was pruned'; END IF;

  PERFORM public.finalize_scheduled_admin_notification_v1(
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000012', 'retry', NULL
  );
  PERFORM public.finalize_scheduled_admin_notification_v1(
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000013', 'sent', NULL
  );
  PERFORM public.finalize_scheduled_admin_notification_v1(
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000014', 'expired', NULL
  );
  SELECT COUNT(*) INTO v_remaining FROM public.admin_notification_audience_snapshot;
  IF v_remaining <> 1 THEN
    RAISE EXCEPTION 'terminal finalization did not prune snapshots';
  END IF;
END;
$$;

ROLLBACK;

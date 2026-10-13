-- =============================================
-- REGRESSION TEST: replay-refresh RPC is ownership-scoped
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/vtu_replay_refresh_fields_scoped_rpc.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- Covers migration 20261012235000 (Codex R50 6rp7ND): the owner VTU
-- SELECT policy is dropped, and the overlay pre-read goes through
-- get_vtu_replay_refresh_fields, which projects exactly three columns
-- for owner rows and zero rows otherwise (no existence oracle).
-- JWT-less service-role callers (the reconciliation cron) still see
-- existing rows.
-- =============================================

BEGIN;

-- The widened policy must be gone: customers read refresh fields
-- through the RPC, never the table projection.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'vtu_transactions'
    AND policyname = 'Customers can view own VTU transactions';
  IF n <> 0 THEN
    RAISE EXCEPTION 'SCOPED-RPC-REGRESSION: owner VTU SELECT policy still present';
  END IF;
END $$;

-- Fixtures (as the psql role, before any JWT context is simulated).
ALTER TABLE public.merchants DISABLE TRIGGER USER;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('01ac0000-0000-4000-8000-00000000ab01', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'vtu-refresh-owner@example.com', 'test', now(), now(), now(), '{}', '{}'),
  ('01ac0000-0000-4000-8000-00000000ab02', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'vtu-refresh-other@example.com', 'test', now(), now(), now(), '{}', '{}');
INSERT INTO public.merchants (id, user_id, email, business_name, slug)
VALUES
  ('01ac0000-0000-4000-8000-00000000ab10', '01ac0000-0000-4000-8000-00000000ab01',
    'vtu-refresh-merchant@example.com', 'VTU Refresh Merchant', 'vtu-refresh-merchant');
ALTER TABLE public.merchants ENABLE TRIGGER USER;

ALTER TABLE public.customers DISABLE TRIGGER USER;
INSERT INTO public.customers (id, merchant_id, user_id, email)
VALUES
  ('01ac0000-0000-4000-8000-00000000ab20', '01ac0000-0000-4000-8000-00000000ab10',
    '01ac0000-0000-4000-8000-00000000ab01', 'vtu-refresh-owner@example.com');
ALTER TABLE public.customers ENABLE TRIGGER USER;

ALTER TABLE public.vtu_transactions DISABLE TRIGGER USER;
INSERT INTO public.vtu_transactions (
  id, merchant_id, customer_id, type, network_provider, phone_number,
  amount, request_reference, status, customer_identifier
)
VALUES
  ('01ac0000-0000-4000-8000-00000000ab30', '01ac0000-0000-4000-8000-00000000ab10',
    '01ac0000-0000-4000-8000-00000000ab20', 'airtime', 'mtn', '08012345678',
    100, 'VTU-REFRESH-REGRESSION-1', 'pending', '1234567890');
ALTER TABLE public.vtu_transactions ENABLE TRIGGER USER;

DO $$
DECLARE
  v_owner uuid := '01ac0000-0000-4000-8000-00000000ab01';
  v_other uuid := '01ac0000-0000-4000-8000-00000000ab02';
  v_tx uuid := '01ac0000-0000-4000-8000-00000000ab30';
  v_missing uuid := '01ac0000-0000-4000-8000-00000000ab99';
  n integer;
  v_status text;
BEGIN
  -- Case 1: JWT-less caller (no JWT claims set yet in this
  -- transaction) sees the existing row — the reconciliation cron
  -- path is unchanged.
  SELECT count(*), max(status) INTO n, v_status
  FROM public.get_vtu_replay_refresh_fields(v_tx);
  IF n <> 1 OR v_status <> 'pending' THEN
    RAISE EXCEPTION 'SCOPED-RPC-REGRESSION: JWT-less call returned % row(s)', n;
  END IF;
  SELECT count(*) INTO n
  FROM public.get_vtu_replay_refresh_fields(v_missing);
  IF n <> 0 THEN
    RAISE EXCEPTION 'SCOPED-RPC-REGRESSION: JWT-less call on missing row returned rows';
  END IF;

  -- Case 2: the owner reads exactly the three refresh columns.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  SELECT count(*), max(status) INTO n, v_status
  FROM public.get_vtu_replay_refresh_fields(v_tx);
  IF n <> 1 OR v_status <> 'pending' THEN
    RAISE EXCEPTION 'SCOPED-RPC-REGRESSION: owner call returned % row(s)', n;
  END IF;

  -- Cases 3+4: a non-owner gets the SAME empty set for an
  -- existing-but-not-owned row and a missing row (no oracle, no
  -- error either way).
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  SELECT count(*) INTO n FROM public.get_vtu_replay_refresh_fields(v_tx);
  IF n <> 0 THEN
    RAISE EXCEPTION 'SCOPED-RPC-REGRESSION: non-owner read % row(s) of another customer', n;
  END IF;
  SELECT count(*) INTO n FROM public.get_vtu_replay_refresh_fields(v_missing);
  IF n <> 0 THEN
    RAISE EXCEPTION 'SCOPED-RPC-REGRESSION: non-owner read rows for a missing transaction';
  END IF;
  RESET ROLE;
END $$;

ROLLBACK;

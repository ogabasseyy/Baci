-- =============================================
-- REGRESSION TEST: replay-attributes RPC has no existence oracle
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/vtu_replay_attributes_no_existence_oracle.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- Covers migration 20261012234500 (Muse R50): an authenticated caller
-- must not be able to distinguish "transaction exists but is not
-- mine" from "transaction does not exist" — both take the same
-- silent path. The P0002 missing-row signal is kept for JWT-less
-- service-role callers only.
-- =============================================

BEGIN;

-- Fixtures (as the psql role, before any JWT context is simulated).
ALTER TABLE public.merchants DISABLE TRIGGER USER;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('01ac0000-0000-4000-8000-00000000aa01', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'vtu-oracle-owner@example.com', 'test', now(), now(), now(), '{}', '{}'),
  ('01ac0000-0000-4000-8000-00000000aa02', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'vtu-oracle-other@example.com', 'test', now(), now(), now(), '{}', '{}');
INSERT INTO public.merchants (id, user_id, email, business_name, slug)
VALUES
  ('01ac0000-0000-4000-8000-00000000aa10', '01ac0000-0000-4000-8000-00000000aa01',
    'vtu-oracle-merchant@example.com', 'VTU Oracle Merchant', 'vtu-oracle-merchant');
ALTER TABLE public.merchants ENABLE TRIGGER USER;

ALTER TABLE public.customers DISABLE TRIGGER USER;
INSERT INTO public.customers (id, merchant_id, user_id, email)
VALUES
  ('01ac0000-0000-4000-8000-00000000aa20', '01ac0000-0000-4000-8000-00000000aa10',
    '01ac0000-0000-4000-8000-00000000aa01', 'vtu-oracle-owner@example.com');
ALTER TABLE public.customers ENABLE TRIGGER USER;

ALTER TABLE public.vtu_transactions DISABLE TRIGGER USER;
INSERT INTO public.vtu_transactions (
  id, merchant_id, customer_id, type, network_provider, phone_number,
  amount, request_reference, status
)
VALUES
  ('01ac0000-0000-4000-8000-00000000aa30', '01ac0000-0000-4000-8000-00000000aa10',
    '01ac0000-0000-4000-8000-00000000aa20', 'airtime', 'mtn', '08012345678',
    100, 'VTU-ORACLE-REGRESSION-1', 'pending');
ALTER TABLE public.vtu_transactions ENABLE TRIGGER USER;

DO $$
DECLARE
  v_owner uuid := '01ac0000-0000-4000-8000-00000000aa01';
  v_other uuid := '01ac0000-0000-4000-8000-00000000aa02';
  v_tx uuid := '01ac0000-0000-4000-8000-00000000aa30';
  v_missing uuid := '01ac0000-0000-4000-8000-00000000aa99';
  v_metadata_before jsonb;
  v_metadata_after jsonb;
BEGIN
  -- Case 1: JWT-less caller (no JWT claims set yet in this
  -- transaction) still gets the loud P0002 signal on a missing row —
  -- the cron resolves its IDs server-side, so that is a caller bug.
  BEGIN
    PERFORM public.set_vtu_transaction_replay_attributes(
      v_missing, '08012345678', 'VAL-1'
    );
    RAISE EXCEPTION 'ORACLE-REGRESSION: JWT-less call on a missing row did not raise P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    -- Expected.
  END;

  SELECT metadata INTO v_metadata_before
  FROM public.vtu_transactions WHERE id = v_tx;

  -- Cases 2+3: an authenticated non-owner gets the SAME silent path
  -- for an existing-but-not-owned row and a missing row. Either
  -- raising (or the two observably differing) fails this test.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM public.set_vtu_transaction_replay_attributes(
    v_tx, '08099999999', 'VAL-OTHER'
  );
  PERFORM public.set_vtu_transaction_replay_attributes(
    v_missing, '08099999999', 'VAL-OTHER'
  );

  -- Case 4: the owner call applies the patch.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM public.set_vtu_transaction_replay_attributes(
    v_tx, '08012345678', 'VAL-OWNER'
  );
  RESET ROLE;

  -- The non-owner calls must not have modified the row: only the
  -- owner patch is present afterwards.
  SELECT metadata INTO v_metadata_after
  FROM public.vtu_transactions WHERE id = v_tx;
  IF v_metadata_after->>'customerPhone' <> '08012345678'
    OR v_metadata_after->>'validationReference' <> 'VAL-OWNER'
  THEN
    RAISE EXCEPTION 'ORACLE-REGRESSION: owner patch missing or polluted by non-owner call: %',
      v_metadata_after;
  END IF;
  IF v_metadata_before = v_metadata_after THEN
    RAISE EXCEPTION 'ORACLE-REGRESSION: owner call did not modify metadata';
  END IF;
END $$;

ROLLBACK;

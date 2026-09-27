-- =============================================
-- PR 3468 follow-up payment hardening.
--
-- 1) The proof-less 4-arg
--    complete_immediate_order_notification_with_proof(uuid, text,
--    boolean, uuid) overload must be gone: the 5-arg proof-bound
--    signature is the only completion entrypoint.
--
-- 2) The ownership-bound sessionless flag stamps the pending payment
--    transaction only when auth.uid() owns the reference order's
--    customer record; strangers, unknown references, completed rows,
--    and repeat polls never flag. Privilege shape: authenticated and
--    service_role execute; anon cannot.
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/pr3468_followup_payment_hardening.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

-- customers.user_id references auth.users: seed the owner rows as the
-- session superuser (service_role cannot write the auth schema).
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('9f000000-0000-4000-8000-000000000719', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'followup-flag-owner@example.com', 'test', now(), now(), now(), '{}', '{}'),
  ('9f000000-0000-4000-8000-000000000718', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'followup-flag-other@example.com', 'test', now(), now(), now(), '{}', '{}');

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '9f000000-0000-4000-8000-000000000711';
  v_mine_customer_id uuid := '9f000000-0000-4000-8000-000000000712';
  v_theirs_customer_id uuid := '9f000000-0000-4000-8000-000000000713';
  v_mine_order_id uuid := '9f000000-0000-4000-8000-000000000714';
  v_theirs_order_id uuid := '9f000000-0000-4000-8000-000000000715';
  v_mine_txn_id uuid := '9f000000-0000-4000-8000-000000000716';
  v_theirs_txn_id uuid := '9f000000-0000-4000-8000-000000000717';
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    'followup-flag-regression@example.com',
    'Followup Flag Regression',
    'followup-flag-regression'
  );
  INSERT INTO public.customers (id, user_id)
  VALUES
    (v_mine_customer_id, '9f000000-0000-4000-8000-000000000719'),
    (v_theirs_customer_id, '9f000000-0000-4000-8000-000000000718');
  INSERT INTO public.orders (id, merchant_id, order_number, total, customer_id, payment_status)
  VALUES
    (v_mine_order_id, v_merchant_id, 'FOLLOWUP-FLAG-001', 50000, v_mine_customer_id, 'pending'),
    (v_theirs_order_id, v_merchant_id, 'FOLLOWUP-FLAG-002', 75000, v_theirs_customer_id, 'pending');
  INSERT INTO public.transactions (
    id, merchant_id, transaction_type, amount, currency, status, order_id,
    gateway_reference, gateway, metadata
  )
  VALUES
    (
      v_mine_txn_id, v_merchant_id, 'payment',
      50000, 'NGN', 'pending', v_mine_order_id, 'FOLLOWUP-FLAG-MINE',
      'paystack', '{}'::jsonb
    ),
    (
      v_theirs_txn_id, v_merchant_id, 'payment',
      75000, 'NGN', 'pending', v_theirs_order_id, 'FOLLOWUP-FLAG-THEIRS',
      'korapay', '{}'::jsonb
    );
END;
$$;

-- The proof-less 4-arg completion overload must not exist; the 5-arg
-- proof-bound signature is the only completion entrypoint.
DO $$
DECLARE
  v_legacy_count integer;
  v_proofed_count integer;
BEGIN
  -- Match overloads by OID vector, not the formatted identity string:
  -- pg_get_function_identity_arguments renders parameter names
  -- ('p_order_id uuid, ...'), so a typelist comparison never matches.
  -- OIDs are pinned bootstrap values: 2950 uuid, 25 text, 16 boolean.
  SELECT count(*) INTO v_legacy_count
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'complete_immediate_order_notification_with_proof'
    AND p.proargtypes::pg_catalog.text = '2950 25 16 2950';
  ASSERT v_legacy_count = 0, 'proof-less 4-arg completion overload must be dropped';
  SELECT count(*) INTO v_proofed_count
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'complete_immediate_order_notification_with_proof'
    AND p.proargtypes::pg_catalog.text = '2950 25 16 2950 25';
  ASSERT v_proofed_count = 1, 'proof-bound 5-arg completion overload must survive';
END;
$$;

-- Stay service_role: the flag RPC reads ownership from auth.uid() (JWT
-- claim, role-independent) and is SECURITY DEFINER, while the
-- verification reads/writes below need to bypass transactions RLS.
-- The authenticated/anon EXECUTE shape is asserted explicitly.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000719', true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'authenticated', 'sub', '9f000000-0000-4000-8000-000000000719'
  )::text,
  true
);

DO $$
DECLARE
  v_flagged boolean;
  v_updated_at timestamptz;
BEGIN
  -- A stranger's reference never flags, without touching the row.
  SELECT public.flag_sessionless_payment_provider_confirmed(
    'FOLLOWUP-FLAG-THEIRS'
  ) INTO v_flagged;
  ASSERT v_flagged = false, 'stranger reference must not flag';

  -- Unknown and blank references never flag.
  SELECT public.flag_sessionless_payment_provider_confirmed(
    'FOLLOWUP-FLAG-NOPE'
  ) INTO v_flagged;
  ASSERT v_flagged = false, 'unknown reference must not flag';
  SELECT public.flag_sessionless_payment_provider_confirmed(
    '   '
  ) INTO v_flagged;
  ASSERT v_flagged = false, 'blank reference must not flag';

  -- The owner's own pending row flags and stamps the sweep marker.
  SELECT public.flag_sessionless_payment_provider_confirmed(
    'FOLLOWUP-FLAG-MINE'
  ) INTO v_flagged;
  ASSERT v_flagged = true, 'owner flag must win';
  SELECT updated_at INTO v_updated_at
  FROM public.transactions
  WHERE gateway_reference = 'FOLLOWUP-FLAG-MINE';
  ASSERT (
    SELECT metadata->>'guest_provider_confirmed'
    FROM public.transactions
    WHERE gateway_reference = 'FOLLOWUP-FLAG-MINE'
  ) = 'true', 'flag must stamp the transaction';

  -- First flag wins: repeat polls neither restamp nor extend the
  -- sweep grace.
  SELECT public.flag_sessionless_payment_provider_confirmed(
    'FOLLOWUP-FLAG-MINE'
  ) INTO v_flagged;
  ASSERT v_flagged = false, 'repeat flag must be a no-op';
  ASSERT (
    SELECT updated_at FROM public.transactions
    WHERE gateway_reference = 'FOLLOWUP-FLAG-MINE'
  ) = v_updated_at, 'repeat flag must not bump updated_at';

  -- Completed rows never flag.
  UPDATE public.transactions SET status = 'completed'
  WHERE gateway_reference = 'FOLLOWUP-FLAG-MINE';
  UPDATE public.transactions
  SET metadata = metadata - 'guest_provider_confirmed' - 'guest_provider_confirmed_at'
  WHERE gateway_reference = 'FOLLOWUP-FLAG-MINE';
  SELECT public.flag_sessionless_payment_provider_confirmed(
    'FOLLOWUP-FLAG-MINE'
  ) INTO v_flagged;
  ASSERT v_flagged = false, 'completed transaction must not flag';

  -- Privilege shape: authenticated and service_role execute; anon
  -- cannot (no user session means no ownership to prove).
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.flag_sessionless_payment_provider_confirmed(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must execute flag_sessionless_payment_provider_confirmed(text)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.flag_sessionless_payment_provider_confirmed(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must execute flag_sessionless_payment_provider_confirmed(text)';
  END IF;
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.flag_sessionless_payment_provider_confirmed(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not execute flag_sessionless_payment_provider_confirmed(text)';
  END IF;
END;
$$;

ROLLBACK;

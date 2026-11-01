-- Regression test: SECURITY DEFINER customer-wallet writers are service-role
-- only. refund_customer_wallet_for_vtu regressed when 20261016010000 re-created
-- it and revoked only PUBLIC, leaving the default anon/authenticated grants.
-- The other writers are a snapshot guard against the same regression.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/vtu_refund_wallet_credit_privileges.sql

BEGIN;

DO $$
DECLARE
  v_signature text;
  v_rpc regprocedure;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.refund_customer_wallet_for_vtu(uuid,uuid,numeric,uuid,text,text)',
    'public.credit_customer_wallet(uuid,uuid,numeric,text,uuid,text)',
    'public.redeem_customer_wallet(uuid,uuid,numeric,text,uuid,text)',
    'public.redeem_vtu_wallet_payment(uuid,uuid,numeric,uuid,text)',
    'public.reverse_vtu_wallet_payment(uuid,text,uuid,text)',
    'public.backfill_wallet_balances()'
  ]
  LOOP
    v_rpc := pg_catalog.to_regprocedure(v_signature);

    IF v_rpc IS NULL THEN
      RAISE EXCEPTION '% is missing', v_signature;
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_rpc, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon must not execute %', v_signature;
    END IF;

    IF pg_catalog.has_function_privilege(
      'authenticated',
      v_rpc,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'authenticated must not execute %', v_signature;
    END IF;

    IF NOT pg_catalog.has_function_privilege(
      'service_role',
      v_rpc,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'service_role must execute %', v_signature;
    END IF;
  END LOOP;
END
$$;

ROLLBACK;

-- Regression test: the order-notification worker claim RPC is internal-only.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/order_notification_outbox_rpc_privileges.sql

BEGIN;

DO $$
DECLARE
  v_claim_rpc regprocedure :=
    pg_catalog.to_regprocedure(
      'public.claim_order_notification_outbox(integer,text)'
    );
BEGIN
  IF v_claim_rpc IS NULL THEN
    RAISE EXCEPTION
      'claim_order_notification_outbox(integer,text) is missing';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_claim_rpc, 'EXECUTE') THEN
    RAISE EXCEPTION
      'anon must not execute claim_order_notification_outbox(integer,text)';
  END IF;

  IF pg_catalog.has_function_privilege(
    'authenticated',
    v_claim_rpc,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'authenticated must not execute claim_order_notification_outbox(integer,text)';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    v_claim_rpc,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'service_role must execute claim_order_notification_outbox(integer,text)';
  END IF;
END
$$;

ROLLBACK;

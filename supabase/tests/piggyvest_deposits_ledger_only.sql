-- Contract test: PiggyVest deposits are recorded in the PiggyVest receipt
-- ledger only and never credit the legacy wallet row.
--
-- Proves, against live PostgreSQL:
--   * neither the bank-deposit function (apply_inflow) nor the card-funding
--     settlement function names the legacy wallet tables any more;
--   * the guard trigger is installed and enabled on the legacy wallet
--     transaction history, and its function is callable by nobody;
--   * a row with either deposit source written to the legacy history is
--     rejected by the guard (check_violation), while other sources are not
--     stopped by it.
-- Denials are asserted through the catalog, never by calling a denied
-- function. The behaviour of the two functions themselves is covered by the
-- isolated fixtures primary-wallet-inflow-ledger-only and
-- primary-wallet-card-custody-ledger-only under apps/web/src/lib/piggyvest.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_deposits_ledger_only.sql

BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

SELECT pg_temp.check(
  (SELECT count(*) FROM pg_catalog.pg_proc p
     JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'piggyvest_primary' AND p.proname = 'apply_inflow'
      AND p.prosrc !~* 'customer_wallet') = 1,
  'apply_inflow must not touch the legacy wallet tables');

SELECT pg_temp.check(
  (SELECT count(*) FROM pg_catalog.pg_proc p
     JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'piggyvest_primary_card'
      AND p.proname = 'settle_custody_ledger_impl'
      AND p.prosrc !~* 'customer_wallet') = 1,
  'card custody settlement must not touch the legacy wallet tables');

SELECT pg_temp.check(
  EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
           WHERE t.tgrelid = 'public.customer_wallet_transactions'::regclass
             AND t.tgname = 'reject_piggyvest_deposit_wallet_credit'
             AND t.tgenabled = 'O' AND NOT t.tgisinternal),
  'deposit guard trigger missing or disabled');

SELECT pg_temp.check(
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
     WHERE p.oid = 'piggyvest_primary.reject_deposit_wallet_credit()'::regprocedure
       AND a.privilege_type = 'EXECUTE' AND a.grantee = 0),
  'guard function must not be executable by PUBLIC');

SELECT pg_temp.check(
  NOT pg_catalog.has_function_privilege('anon', 'piggyvest_primary.reject_deposit_wallet_credit()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated', 'piggyvest_primary.reject_deposit_wallet_credit()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('service_role', 'piggyvest_primary.reject_deposit_wallet_credit()', 'EXECUTE'),
  'guard function must not be executable by anon, authenticated or service_role');

-- The guard fires before any constraint check, so dummy values suffice.
DO $$
DECLARE source text;
BEGIN
  FOREACH source IN ARRAY ARRAY['piggyvest_primary_inflow', 'piggyvest_primary_card_custody'] LOOP
    BEGIN
      INSERT INTO public.customer_wallet_transactions (id, wallet_id, customer_id, merchant_id, type, amount, balance_after, source_type)
        VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'credit', 1, 1, source);
      RAISE EXCEPTION 'deposit credit accepted for %', source;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  -- A different source is not stopped by the guard: it fails later (foreign
  -- key), never with the guard's own message.
  BEGIN
    INSERT INTO public.customer_wallet_transactions (id, wallet_id, customer_id, merchant_id, type, amount, balance_after, source_type)
      VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'credit', 1, 1, 'piggyvest_primary_card_reversal');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PiggyVest deposits are recorded%' THEN
      RAISE EXCEPTION 'guard stopped an unrelated source';
    END IF;
  END;
END $$;

-- The guard also covers a neutral row being relabelled as a deposit.
SELECT pg_temp.check(
  coalesce((SELECT pg_catalog.pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT OR UPDATE OF source_type ON%'
              FROM pg_catalog.pg_trigger t
             WHERE t.tgrelid = 'public.customer_wallet_transactions'::regclass
               AND t.tgname = 'reject_piggyvest_deposit_wallet_credit'), false),
  'deposit guard must fire on INSERT and on UPDATE OF source_type');

ROLLBACK;

-- Catalog assertions for the owner-only "Baci pays shipping" mode.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/platform_funded_gigl_shipping.sql
BEGIN;

DO $$
DECLARE
  v_role text;
  v_src text;
BEGIN
  -- 1. The flag lives in a private, RLS-locked table nobody but postgres reads.
  IF pg_catalog.to_regclass('private.platform_funded_gigl_merchants') IS NULL THEN
    RAISE EXCEPTION 'private.platform_funded_gigl_merchants is missing';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
          WHERE c.oid = 'private.platform_funded_gigl_merchants'::regclass) THEN
    RAISE EXCEPTION 'RLS must be enabled on the platform flag table';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies
             WHERE schemaname = 'private'
               AND tablename = 'platform_funded_gigl_merchants') THEN
    RAISE EXCEPTION 'the platform flag table must have no RLS policies';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_table_privilege(
         v_role, 'private.platform_funded_gigl_merchants',
         'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
      RAISE EXCEPTION '% must hold no privilege on the platform flag table', v_role;
    END IF;
  END LOOP;

  -- 2. Charges carry an explicit funding source; platform charges never debit.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'merchant_shipping_charges'
                   AND column_name = 'funding_source'
                   AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'merchant_shipping_charges.funding_source is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = 'public.merchant_shipping_charges'::regclass
                   AND conname = 'merchant_shipping_charges_platform_no_wallet_movement') THEN
    RAISE EXCEPTION 'platform charge no-wallet-movement check is missing';
  END IF;

  -- 3. The mode resolver is a narrow DEFINER RPC for signed-in callers only.
  IF pg_catalog.has_function_privilege(
       'anon', 'public.get_gigl_shipping_funding_mode(uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', 'public.get_gigl_shipping_funding_mode(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_gigl_shipping_funding_mode must be authenticated-only';
  END IF;

  -- 4. Existing guards stay and the platform branch is wired in.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.reserve_merchant_shipping_charge(uuid,uuid,text)'::regprocedure;
  IF v_src NOT LIKE '%platform_funded_gigl_merchants%'
     OR v_src NOT LIKE '%merchant_wallet_direct_settled_exposure%'
     OR v_src NOT LIKE '%MERCHANT_WALLET_INSUFFICIENT%' THEN
    RAISE EXCEPTION 'reserve_merchant_shipping_charge lost a guard or the platform branch';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.refund_merchant_shipping_charge(uuid,text,text)'::regprocedure;
  IF v_src NOT LIKE '%funding_source%platform%' THEN
    RAISE EXCEPTION 'refund_merchant_shipping_charge must skip wallet credit for platform charges';
  END IF;
  IF NOT pg_catalog.has_column_privilege(
       'authenticated', 'public.merchant_shipping_charges', 'funding_source', 'SELECT')
     OR pg_catalog.has_column_privilege(
       'authenticated', 'public.merchant_shipping_charges', 'provider_cost', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated must read funding_source but not internal economics';
  END IF;
  -- The provider-cancellation helper only refunds a charge whose exact wallet
  -- debit exists; platform charges have debit_transaction_id NULL, so it
  -- declines (0 refunds) and the cancel guard keeps the order for manual care.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
  WHERE p.oid = 'private.refund_gigl_wallet_charge_on_provider_cancellation(uuid,uuid,uuid,text,jsonb)'::regprocedure;
  IF v_src NOT LIKE '%debit.id = v_charge.debit_transaction_id%' THEN
    RAISE EXCEPTION 'provider-cancellation refund must require the matching wallet debit';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
  WHERE p.oid = 'private.prevent_active_gigl_shipping_cancellation()'::regprocedure;
  IF v_src NOT LIKE '%funding_source%platform%' THEN
    RAISE EXCEPTION 'cancellation trigger must not credit wallets for platform charges';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.self_fulfill_order_with_wallet_release(uuid,jsonb,text,text)'::regprocedure;
  IF v_src NOT LIKE '%funding_source%platform%' THEN
    RAISE EXCEPTION 'self-fulfilment must not credit wallets for platform charges';
  END IF;
  IF pg_catalog.has_function_privilege(
       'anon', 'public.reserve_merchant_shipping_charge(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute reserve_merchant_shipping_charge';
  END IF;
END
$$;

ROLLBACK;

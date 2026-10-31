-- =====================================================================
-- REGRESSION TEST: GIG merchant-wallet flow for orders.fulfill staff
--
-- Owner decision (2026-10-31): the owner and staff granted orders.fulfill
-- may run the GIG merchant-wallet flow. Read and consent steps (balance,
-- funding account, funding consent and recovery) need orders.fulfill; write
-- steps that commit the order to a booking (bind, a new wallet debit,
-- customer-checkout shipping recovery) need orders.fulfill AND orders.edit,
-- matching the orders.edit the booking claim already requires. Staff without
-- orders.fulfill stay blocked. New debits and funding requests record the
-- acting user. Replaces gigl_wallet_reservation_owner_only.sql, whose
-- owner-only assertions no longer describe the live definitions.
--
-- Denied EXECUTE is asserted via the catalog: on the pinned replay image a
-- denied function EXECUTE cannot be trapped by an exception handler.
-- Behaviour (owner, fulfil, edit-only, view-only, pending and removed staff)
-- is exercised by apps/web/src/lib/shipping/gigl-wallet-staff-access.postgres.test.ts
-- and customer-checkout-shipping-recovery-retry.postgres.test.ts.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/migrations/tests/gigl_wallet_fulfil_staff_access.sql
-- =====================================================================

BEGIN;

-- --- Effective EXECUTE: authenticated only; never anon or PUBLIC.
DO $grants$
DECLARE
  v_fn regprocedure;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.get_merchant_shipping_wallet_balance(uuid)'::regprocedure,
    'public.get_merchant_wallet_funding_account(uuid)'::regprocedure,
    'public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb)'::regprocedure,
    'public.reserve_merchant_shipping_charge(uuid, uuid, text)'::regprocedure,
    'public.fail_merchant_wallet_funding_request(uuid, uuid)'::regprocedure,
    'public.complete_merchant_wallet_funding_recovery(uuid, uuid, text, text, text, text, text, text, timestamptz, text, text)'::regprocedure,
    'public.confirm_customer_checkout_shipping_recovery(uuid, uuid, boolean)'::regprocedure
  ] LOOP
    IF pg_catalog.has_function_privilege('anon', v_fn::oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon must NOT have EXECUTE on %', v_fn;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) a
      WHERE p.oid = v_fn::oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'PUBLIC must NOT have EXECUTE on %', v_fn;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_fn::oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated must have EXECUTE on %', v_fn;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = v_fn::oid AND p.prosecdef
        AND 'search_path=""' = ANY (p.proconfig)
    ) THEN
      RAISE EXCEPTION '% must be SECURITY DEFINER with an empty search_path', v_fn;
    END IF;
  END LOOP;
END;
$grants$;

-- --- The recovery assertion stays a private, client-unreachable helper.
DO $private_assert$
DECLARE
  v_fn regprocedure :=
    'private.assert_customer_checkout_shipping_recovery(uuid)'::regprocedure;
BEGIN
  IF pg_catalog.has_function_privilege('authenticated', v_fn::oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_fn::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'clients must NOT have EXECUTE on %', v_fn;
  END IF;
END;
$private_assert$;

-- --- Every gate uses the DEFINER permission helper with orders.fulfill;
--     write gates also require orders.edit, read/consent gates do not.
DO $gates$
DECLARE
  v_name text;
  v_definition text;
  v_write text[] := ARRAY[
    'public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb)',
    'public.confirm_customer_checkout_shipping_recovery(uuid, uuid, boolean)',
    'private.assert_customer_checkout_shipping_recovery(uuid)'
  ];
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'public.get_merchant_shipping_wallet_balance(uuid)',
    'public.get_merchant_wallet_funding_account(uuid)',
    'public.fail_merchant_wallet_funding_request(uuid, uuid)',
    'public.complete_merchant_wallet_funding_recovery(uuid, uuid, text, text, text, text, text, text, timestamptz, text, text)'
  ] || v_write LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_name::regprocedure);
    IF v_definition !~ 'check_staff_permission\([^;]*''orders'',\s*''fulfill''' THEN
      RAISE EXCEPTION '% must gate on check_staff_permission orders.fulfill', v_name;
    END IF;
    IF v_name = ANY (v_write) THEN
      IF (SELECT count(*) FROM regexp_matches(v_definition, '''orders'',\s*''fulfill''', 'g'))
         IS DISTINCT FROM
         (SELECT count(*) FROM regexp_matches(v_definition, '''orders'',\s*''edit''', 'g')) THEN
        RAISE EXCEPTION '% must pair every orders.fulfill check with orders.edit', v_name;
      END IF;
    ELSIF v_definition ~ '''orders'',\s*''edit''' THEN
      RAISE EXCEPTION '% read/consent gate must not require orders.edit', v_name;
    END IF;
    -- A merchants lookup keyed on the caller is an owner check; the staff
    -- row lock (staff_members ... user_id=auth.uid() FOR SHARE) is not.
    IF v_definition ~ 'public\.merchants[^;]*user_id\s*=\s*(\(SELECT )?auth\.uid\(\)' THEN
      RAISE EXCEPTION '% must not keep an owner-only user_id check', v_name;
    END IF;
  END LOOP;
END;
$gates$;

-- --- New wallet debits: owner or orders.fulfill AND orders.edit, after
--     existing-charge recovery (fulfill OR edit) and before the debit.
DO $reserve$
DECLARE
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.reserve_merchant_shipping_charge(uuid, uuid, text)'::regprocedure
  );
  v_existing integer;
  v_gate integer;
  v_debit integer;
  v_new_debit text;
BEGIN
  v_existing := strpos(v_definition, 'IF v_existing.id IS NOT NULL THEN');
  v_gate := strpos(v_definition, 'wallet_reservation_fulfill_edit_required');
  v_debit := strpos(v_definition, 'INSERT INTO public.wallet_transactions(');
  IF v_existing = 0 OR v_gate <= v_existing OR v_debit <= v_gate THEN
    RAISE EXCEPTION 'new-debit fulfil+edit gate must sit between recovery and the debit';
  END IF;
  v_new_debit := substr(
    v_definition,
    strpos(v_definition, 'RETURN;'),
    v_gate - strpos(v_definition, 'RETURN;')
  );
  IF v_new_debit !~ '''orders'',\s*''fulfill''[^;]*AND[^;]*''orders'',\s*''edit''' THEN
    RAISE EXCEPTION 'new wallet debits must require orders.fulfill AND orders.edit';
  END IF;
  IF strpos(v_definition, 'wallet_reservation_owner_required') > 0 THEN
    RAISE EXCEPTION 'reserve must not keep the owner-only new-debit gate';
  END IF;
  IF strpos(v_definition, 'v_order.merchant_id, ''orders'', ''edit''') = 0 THEN
    RAISE EXCEPTION 'reserve must keep orders.edit for resuming existing charges';
  END IF;
END;
$reserve$;

-- --- Funding requests: DEFINER helper, authenticated only, pending inserts.
DO $policies$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'merchant_wallet_funding_account_requests'
      AND (
        COALESCE(qual, '') || COALESCE(with_check, '') ~ 'merchants|staff_members'
        OR roles <> ARRAY['authenticated']::name[]
      )
  ) THEN
    RAISE EXCEPTION 'funding request policies must use check_staff_permission for authenticated only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'merchant_wallet_funding_account_requests'
      AND policyname = 'merchant_wallet_request_fulfill_insert'
      AND with_check ~ 'status = ''pending'''
      AND with_check ~ 'requested_by = \( SELECT auth\.uid\(\)'
      AND with_check ~ 'check_staff_permission'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'merchant_wallet_funding_account_requests'
      AND policyname = 'merchant_wallet_request_fulfill_read'
      AND qual ~ 'check_staff_permission'
  ) THEN
    RAISE EXCEPTION 'funding request fulfil policies are missing';
  END IF;
  -- Payment accounts stay owner-only at the table: staff read the DEFINER
  -- projection, never provider identifiers or metadata.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'merchant_wallet_payment_accounts'
      AND policyname = 'merchant_wallet_account_owner'
  ) THEN
    RAISE EXCEPTION 'payment account owner policy must remain';
  END IF;
END;
$policies$;

-- --- Actor attribution: defaults capture the caller; clients cannot write
--     reserved_by, and authenticated can read it.
DO $actor$
DECLARE
  v_table text;
  v_column text;
BEGIN
  FOR v_table, v_column IN VALUES
    ('public.merchant_shipping_charges', 'reserved_by'),
    ('public.merchant_wallet_funding_account_requests', 'requested_by')
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = v_table::regclass
        AND a.attname = v_column
        AND NOT a.attisdropped
        AND a.atttypid = 'uuid'::regtype
        AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) = 'auth.uid()'
    ) THEN
      RAISE EXCEPTION '%.% must be uuid DEFAULT auth.uid()', v_table, v_column;
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_column_privilege(
       'authenticated', 'public.merchant_shipping_charges', 'reserved_by', 'SELECT')
     OR pg_catalog.has_column_privilege(
       'authenticated', 'public.merchant_shipping_charges', 'reserved_by', 'INSERT')
     OR pg_catalog.has_column_privilege(
       'authenticated', 'public.merchant_shipping_charges', 'reserved_by', 'UPDATE')
     OR pg_catalog.has_column_privilege(
       'authenticated', 'public.merchant_wallet_funding_account_requests', 'requested_by', 'UPDATE') THEN
    RAISE EXCEPTION 'actor columns must be readable, never client-writable after insert';
  END IF;
  -- anon keeps a pre-existing table-level SELECT grant on
  -- merchant_shipping_charges (Supabase default privileges), so a column
  -- privilege check is meaningless there. What keeps the actor column from
  -- anon is RLS: it must stay enabled with no policy that applies to anon.
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
          WHERE c.oid = 'public.merchant_shipping_charges'::regclass)
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy pol
       WHERE pol.polrelid = 'public.merchant_shipping_charges'::regclass
         AND (pol.polroles = ARRAY[0::oid]
              OR 'anon'::regrole::oid = ANY (pol.polroles))
     ) THEN
    RAISE EXCEPTION 'merchant_shipping_charges must stay RLS-protected from anon';
  END IF;
END;
$actor$;

ROLLBACK;

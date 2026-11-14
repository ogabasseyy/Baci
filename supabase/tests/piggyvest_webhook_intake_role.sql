-- Contract tests for the PiggyVest webhook intake role (GL-D). Authority is
-- asserted through the catalog (never by calling a denied function and
-- trapping the error); behaviour is exercised as the restricted group role
-- itself, so a function that only works for its owner would fail here.
-- Synthetic, transaction-local fixture.
BEGIN;

DO $$
DECLARE
  intake_functions text[] := ARRAY[
    'capture_delivery', 'resolve_capture', 'claim_event', 'resolve_event',
    'allocate_plan_transfer', 'apply_staging_restriction', 'resolve_staging_owner',
    'inbox_insert', 'inbox_read', 'quarantine_insert', 'inflow_credit_insert',
    'inflow_credit_read', 'interest_payout_insert', 'interest_payout_read',
    'plan_wallet_read', 'plan_wallet_set_status', 'outbox_apply_terminal'];
  fn record;
  t text;
  seen integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'piggyvest_webhook_intake'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication) THEN
    RAISE EXCEPTION 'intake group role missing or over-privileged';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.member
      WHERE g.rolname = 'piggyvest_webhook_intake') THEN
    RAISE EXCEPTION 'intake group role must not inherit from another role';
  END IF;
  IF NOT has_schema_privilege('piggyvest_webhook_intake', 'piggyvest_webhook_intake', 'USAGE') THEN
    RAISE EXCEPTION 'intake group cannot use its schema';
  END IF;
  FOREACH t IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated', 'service_role'] LOOP
    IF t = 'PUBLIC' THEN
      IF EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a
          WHERE n.nspname = 'piggyvest_webhook_intake' AND a.grantee = 0) THEN
        RAISE EXCEPTION 'PUBLIC can reach the intake schema';
      END IF;
    ELSIF has_schema_privilege(t, 'piggyvest_webhook_intake', 'USAGE') THEN
      RAISE EXCEPTION '% can reach the intake schema', t;
    END IF;
  END LOOP;
  FOR fn IN
    SELECT p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'piggyvest_webhook_intake'
  LOOP
    seen := seen + 1;
    IF NOT (fn.proname = ANY (intake_functions)) THEN
      RAISE EXCEPTION 'unexpected intake function %', fn.proname;
    END IF;
    IF NOT fn.prosecdef OR NOT ('search_path=pg_catalog' = ANY (fn.proconfig)) THEN
      RAISE EXCEPTION '% must be SECURITY DEFINER with search_path=pg_catalog', fn.proname;
    END IF;
    IF NOT has_function_privilege('piggyvest_webhook_intake', fn.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'intake group cannot execute %', fn.proname;
    END IF;
    IF EXISTS (SELECT 1 FROM aclexplode(fn.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'PUBLIC can execute %', fn.proname;
    END IF;
    FOREACH t IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(t, fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% can execute %', t, fn.proname;
      END IF;
    END LOOP;
  END LOOP;
  IF seen <> array_length(intake_functions, 1) THEN
    RAISE EXCEPTION 'expected % intake functions, found %', array_length(intake_functions, 1), seen;
  END IF;
  -- No direct authority over any table the receiver touches.
  FOREACH t IN ARRAY ARRAY[
    'piggyvest_webhook_inbox', 'piggyvest_webhook_captures', 'piggyvest_event_quarantine',
    'piggyvest_inflow_credits', 'piggyvest_interest_payouts', 'piggyvest_plan_wallets',
    'piggyvest_transfer_outbox'] LOOP
    IF has_table_privilege('piggyvest_webhook_intake', 'public.' || t,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'intake group holds a direct privilege on %', t;
    END IF;
  END LOOP;
  -- It reaches the existing receiver RPCs only through the wrappers.
  IF has_function_privilege('piggyvest_webhook_intake',
      'public.capture_piggyvest_webhook_delivery(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'intake group must not execute the public capture RPC directly';
  END IF;
END $$;

-- Every existing RPC the wrappers delegate to pins its own search_path, so
-- the wrappers' pg_catalog-only path cannot break relation resolution.
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'capture_piggyvest_webhook_delivery', 'resolve_piggyvest_webhook_capture',
    'claim_piggyvest_webhook_event', 'resolve_piggyvest_webhook_event',
    'allocate_plan_transfer_contribution', 'apply_staging_wallet_restriction',
    'resolve_staging_wallet_owner'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = target
         AND EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c
                      WHERE c LIKE 'search_path=%')) THEN
      RAISE EXCEPTION 'public.% must pin its own search_path', target;
    END IF;
  END LOOP;
END $$;

-- The migration owner is not a member of the NOLOGIN group, so it may not
-- SET ROLE to it (42501); transaction-local membership lets the test act as
-- the restricted role. Rolled back with the rest of the fixture.
GRANT piggyvest_webhook_intake TO CURRENT_USER;

-- Behaviour as the restricted role.
SET LOCAL ROLE piggyvest_webhook_intake;

DO $$
DECLARE
  inserted jsonb;
  row_json jsonb;
BEGIN
  inserted := piggyvest_webhook_intake.inbox_insert(jsonb_build_object(
    'event_id', 'gld-evt-1', 'event_type', 'bank-transfer.inflow.success',
    'event_category', 'bank-transfer', 'customer_id', 'gld-cust', 'wallet_id', 'gld-wallet',
    'reference', 'gld-ref', 'amount_kobo', 1000, 'event_details', jsonb_build_object('transaction_id', 'gld-txn')));
  IF inserted <> '[{"event_id": "gld-evt-1"}]'::jsonb THEN
    RAISE EXCEPTION 'first inbox insert must report the key, got %', inserted;
  END IF;
  inserted := piggyvest_webhook_intake.inbox_insert(jsonb_build_object(
    'event_id', 'gld-evt-1', 'event_type', 'x', 'event_category', 'x', 'customer_id', 'x'));
  IF inserted <> '[]'::jsonb THEN
    RAISE EXCEPTION 'duplicate inbox insert must be a no-op, got %', inserted;
  END IF;
  row_json := piggyvest_webhook_intake.inbox_read('{"event_id": "gld-evt-1"}');
  IF row_json->>'event_type' <> 'bank-transfer.inflow.success'
      OR (row_json->>'amount_kobo')::bigint <> 1000
      OR row_json->'event_details'->>'transaction_id' <> 'gld-txn' THEN
    RAISE EXCEPTION 'inbox read mismatch: %', row_json;
  END IF;
  IF piggyvest_webhook_intake.inbox_read('{"event_id": "gld-missing"}') IS NOT NULL THEN
    RAISE EXCEPTION 'missing inbox row must read as null';
  END IF;
  row_json := piggyvest_webhook_intake.claim_event('{"event_id": "gld-evt-1"}');
  IF row_json->>'outcome' <> 'claimed' THEN
    RAISE EXCEPTION 'claim should win a pending row, got %', row_json;
  END IF;
  IF piggyvest_webhook_intake.claim_event('{"event_id": "gld-evt-1"}')->>'outcome' <> 'busy' THEN
    RAISE EXCEPTION 'second claim must see a busy lease';
  END IF;
  IF piggyvest_webhook_intake.resolve_event(jsonb_build_object(
      'event_id', 'gld-evt-1', 'claim_token', row_json->>'claim_token', 'status', 'processed'))
      IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'resolve must accept the holder of the lease';
  END IF;

  inserted := piggyvest_webhook_intake.quarantine_insert(jsonb_build_object(
    'event_id', 'gld-evt-1', 'event_type', 't', 'body_digest', repeat('a', 64),
    'reason', 'unknown-event', 'detail', NULL));
  IF jsonb_array_length(inserted) <> 1 THEN
    RAISE EXCEPTION 'quarantine insert must report one row';
  END IF;
  IF piggyvest_webhook_intake.quarantine_insert(jsonb_build_object(
      'body_digest', repeat('a', 64), 'reason', 'unknown-event')) <> '[]'::jsonb THEN
    RAISE EXCEPTION 'duplicate quarantine digest must be a no-op';
  END IF;

  inserted := piggyvest_webhook_intake.inflow_credit_insert(jsonb_build_object(
    'pvb_reference', 'PVB01GLD1', 'provider_transaction_id', 'gld-txn', 'event_data_id', 'gld-data', 'event_id', 'gld-evt-1',
    'customer_id', 'gld-cust', 'wallet_id', 'gld-wallet', 'amount_kobo', 1000, 'fee_kobo', 0,
    'reference', 'gld-ref', 'session_id', NULL, 'credited_at', '2026-11-04T10:00:00.000Z'));
  IF jsonb_array_length(inserted) <> 1 THEN
    RAISE EXCEPTION 'inflow credit insert must report one row';
  END IF;
  IF piggyvest_webhook_intake.inflow_credit_insert(jsonb_build_object(
      'pvb_reference', 'PVB01GLD2', 'provider_transaction_id', 'gld-txn', 'event_data_id', 'other', 'event_id', 'e2',
      'customer_id', 'c', 'wallet_id', 'w', 'amount_kobo', 5, 'fee_kobo', 0, 'reference', 'r',
      'credited_at', '2026-11-04T10:00:00.000Z')) <> '[]'::jsonb THEN
    RAISE EXCEPTION 'first writer must win a duplicate transaction id';
  END IF;
  row_json := piggyvest_webhook_intake.inflow_credit_read('{"provider_transaction_id": "gld-txn"}');
  IF (row_json->>'amount_kobo')::bigint <> 1000 OR row_json->>'session_id' IS NOT NULL THEN
    RAISE EXCEPTION 'inflow credit read mismatch: %', row_json;
  END IF;

  inserted := piggyvest_webhook_intake.interest_payout_insert(jsonb_build_object(
    'pvb_reference', 'PVB01GLD3', 'provider_payout_id', 'gld-payout', 'event_id', 'gld-evt-2', 'customer_id', 'gld-cust',
    'wallet_id', 'gld-wallet', 'amount_kobo', 90, 'gross_kobo', 100, 'withholding_tax_kobo', 10,
    'net_kobo', 90, 'reference', 'gld-ref', 'batch_id', 'gld-batch',
    'paid_at', '2026-11-04T10:00:00.000Z'));
  IF jsonb_array_length(inserted) <> 1 THEN
    RAISE EXCEPTION 'interest payout insert must report one row';
  END IF;
  row_json := piggyvest_webhook_intake.interest_payout_read('{"provider_payout_id": "gld-payout"}');
  IF (row_json->>'net_kobo')::bigint <> 90 THEN
    RAISE EXCEPTION 'interest payout read mismatch: %', row_json;
  END IF;
END $$;

RESET ROLE;

-- Wallet status and outbox terminal functions, over plain fixture rows.
INSERT INTO public.piggyvest_plan_wallets (customer_id, merchant_id, piggyvest_customer_id, wallet_id, subaccount_name)
VALUES ('f3840000-0000-4000-8000-000000000001', 'f3840000-0000-4000-8000-000000000002',
  'gld-pv-cust', 'gld-plan-wallet', 'gld');
INSERT INTO public.piggyvest_transfer_outbox (reference, customer_id, merchant_id, wallet_id, amount_kobo, direction, destination_ref)
VALUES ('gld-out-1', 'f3840000-0000-4000-8000-000000000001', 'f3840000-0000-4000-8000-000000000002',
  'gld-plan-wallet', 100, 'wallet', 'dest');

SET LOCAL ROLE piggyvest_webhook_intake;

DO $$
DECLARE
  result jsonb;
BEGIN
  IF piggyvest_webhook_intake.plan_wallet_read('{"wallet_id": "gld-plan-wallet"}')->>'status' <> 'provisioning' THEN
    RAISE EXCEPTION 'plan wallet read mismatch';
  END IF;
  result := piggyvest_webhook_intake.plan_wallet_set_status(
    '{"wallet_id": "gld-plan-wallet", "status": "restricted"}');
  IF result <> '[{"wallet_id": "gld-plan-wallet"}]'::jsonb THEN
    RAISE EXCEPTION 'status flip must report the wallet, got %', result;
  END IF;
  IF piggyvest_webhook_intake.plan_wallet_set_status(
      '{"wallet_id": "gld-unknown-wallet", "status": "ready"}') <> '[]'::jsonb THEN
    RAISE EXCEPTION 'unknown wallet must flip nothing';
  END IF;
  result := piggyvest_webhook_intake.outbox_apply_terminal(
    '{"reference": "gld-out-1", "status": "succeeded"}');
  IF result <> '[{"reference": "gld-out-1"}]'::jsonb THEN
    RAISE EXCEPTION 'outbox terminal must report the reference, got %', result;
  END IF;
  IF piggyvest_webhook_intake.outbox_apply_terminal(
      '{"reference": "gld-out-1", "status": "failed"}') <> '[]'::jsonb THEN
    RAISE EXCEPTION 'a finished outbox row must not transition again';
  END IF;
END $$;

RESET ROLE;

DO $$
BEGIN
  IF (SELECT status FROM public.piggyvest_transfer_outbox WHERE reference = 'gld-out-1') <> 'succeeded' THEN
    RAISE EXCEPTION 'outbox row should stay succeeded';
  END IF;
  IF (SELECT status FROM public.piggyvest_plan_wallets WHERE wallet_id = 'gld-plan-wallet') <> 'restricted' THEN
    RAISE EXCEPTION 'plan wallet should be restricted';
  END IF;
END $$;

ROLLBACK;

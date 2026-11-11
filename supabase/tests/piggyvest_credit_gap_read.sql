-- Contract tests for piggyvest_primary.read_credit_gap_ledger: it returns the
-- integration merchant's ready/restricted plan wallets only, each with the
-- pvb_reference values its two credit ledgers recorded since shortly before
-- the window start, counts legacy rows without a key, changes nothing,
-- refuses a wrong binding or malformed options, and EXECUTE reaches only the
-- evidence role. Synthetic, transaction-local fixture.
BEGIN;
UPDATE piggyvest_primary.integrations SET executor_login = 'retired-' || id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.inflow_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;
INSERT INTO auth.users (id, email) VALUES
  ('f3830000-0000-4000-8000-000000000001', 'piggyvest-credit-gap@example.test');
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3830000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f3830000-0000-4000-8000-000000000002', 'f3830000-0000-4000-8000-000000000001',
   'piggyvest-credit-gap@example.test', 'PiggyVest Credit Gap Fixture', 'piggyvest-credit-gap-fixture'),
  ('f3830000-0000-4000-8000-000000000012', 'f3830000-0000-4000-8000-000000000001',
   'piggyvest-credit-gap-other@example.test', 'PiggyVest Credit Gap Other', 'piggyvest-credit-gap-other');
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO piggyvest_primary.integrations
  (id, merchant_id, business_id, environment, executor_login, enabled)
VALUES ('f3830000-0000-4000-8000-000000000006', 'f3830000-0000-4000-8000-000000000002',
  'synthetic-gap-business', 'staging', SESSION_USER, true);
INSERT INTO piggyvest_primary.inflow_authorities (integration_id, executor_login, enabled)
VALUES ('f3830000-0000-4000-8000-000000000006', SESSION_USER, true);
-- Ready and restricted wallets are read; provisioning and another merchant's are not.
INSERT INTO public.piggyvest_plan_wallets
  (customer_id, merchant_id, piggyvest_customer_id, wallet_id, subaccount_name, status)
VALUES
  ('f3830000-0000-4000-8000-0000000000c1', 'f3830000-0000-4000-8000-000000000002', 'pvc-1', 'gap-wallet-a', 'gap-a', 'ready'),
  ('f3830000-0000-4000-8000-0000000000c2', 'f3830000-0000-4000-8000-000000000002', 'pvc-2', 'gap-wallet-b', 'gap-b', 'restricted'),
  ('f3830000-0000-4000-8000-0000000000c3', 'f3830000-0000-4000-8000-000000000002', 'pvc-3', 'gap-wallet-c', 'gap-c', 'provisioning'),
  ('f3830000-0000-4000-8000-0000000000c4', 'f3830000-0000-4000-8000-000000000012', 'pvc-4', 'gap-wallet-d', 'gap-d', 'ready');
INSERT INTO public.piggyvest_inflow_credits
  (pvb_reference, provider_transaction_id, event_data_id, event_id, customer_id, wallet_id,
   amount_kobo, fee_kobo, reference, credited_at, created_at)
VALUES
  ('PVB01GAPRECENT', 'gap-tx-1', 'gap-ed-1', 'gap-ev-1', 'pvc-1', 'gap-wallet-a', 1000, 0, 'r1', now() - interval '1 day', now() - interval '1 day'),
  ('PVB01GAPOLD', 'gap-tx-2', 'gap-ed-2', 'gap-ev-2', 'pvc-1', 'gap-wallet-a', 1000, 0, 'r2', now() - interval '60 days', now() - interval '60 days'),
  (NULL, 'gap-tx-3', 'gap-ed-3', 'gap-ev-3', 'pvc-1', 'gap-wallet-a', 1000, 0, 'r3', now() - interval '1 day', now() - interval '1 day'),
  ('PVB01GAPOTHER', 'gap-tx-4', 'gap-ed-4', 'gap-ev-4', 'pvc-4', 'gap-wallet-d', 1000, 0, 'r4', now() - interval '1 day', now() - interval '1 day');
INSERT INTO public.piggyvest_interest_payouts
  (pvb_reference, provider_payout_id, event_id, customer_id, wallet_id, amount_kobo, gross_kobo,
   withholding_tax_kobo, net_kobo, reference, batch_id, paid_at)
VALUES ('PVB01GAPINTEREST', 'gap-payout-1', 'gap-ev-5', 'pvc-2', 'gap-wallet-b', 95, 100, 5, 95, 'r5', 'b1', now() - interval '2 days');

DO $read$
DECLARE
  integration uuid:='f3830000-0000-4000-8000-000000000006';
  ledger jsonb;
  before_rows text;
BEGIN
  SELECT string_agg(provider_transaction_id||COALESCE(pvb_reference,''),',' ORDER BY provider_transaction_id)
    INTO before_rows FROM public.piggyvest_inflow_credits;
  ledger:=piggyvest_primary.read_credit_gap_ledger(integration,'staging','{"rotationSlot":0}');
  IF ledger->>'businessId' IS DISTINCT FROM 'synthetic-gap-business'
    OR (ledger->>'walletsTotal')::int IS DISTINCT FROM 2
    OR (ledger->>'walletsDeferred')::int IS DISTINCT FROM 0
    OR (ledger->>'windowStart')::timestamptz >= (ledger->>'generatedAt')::timestamptz THEN
    RAISE EXCEPTION 'Unexpected credit gap header: %', ledger;
  END IF;
  IF (SELECT array_agg(item->>'walletId') FROM jsonb_array_elements(ledger->'wallets') item)
    IS DISTINCT FROM ARRAY['gap-wallet-a','gap-wallet-b'] THEN
    RAISE EXCEPTION 'Wrong wallets: %', ledger->'wallets';
  END IF;
  -- Wallet a: the recent keyed inflow only (the 60-day row is outside the
  -- window); the NULL-key row is counted, never listed.
  IF (SELECT array_agg(row_->>'reference') FROM jsonb_array_elements(ledger->'wallets'->0->'inflow') row_)
      IS DISTINCT FROM ARRAY['PVB01GAPRECENT']
    OR (ledger->'wallets'->0->>'unkeyed')::int IS DISTINCT FROM 1
    OR (ledger->'wallets'->0->>'inflowTruncated')::boolean IS DISTINCT FROM false
    OR ledger->'wallets'->0->'interest' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'Wrong wallet a ledger: %', ledger->'wallets'->0;
  END IF;
  IF (SELECT array_agg(row_->>'reference') FROM jsonb_array_elements(ledger->'wallets'->1->'interest') row_)
    IS DISTINCT FROM ARRAY['PVB01GAPINTEREST'] THEN
    RAISE EXCEPTION 'Wrong wallet b ledger: %', ledger->'wallets'->1;
  END IF;
  IF (SELECT string_agg(provider_transaction_id||COALESCE(pvb_reference,''),',' ORDER BY provider_transaction_id)
      FROM public.piggyvest_inflow_credits) IS DISTINCT FROM before_rows THEN
    RAISE EXCEPTION 'Credit gap read changed the inflow ledger';
  END IF;
END;
$read$;

DO $refused$
DECLARE
  integration uuid:='f3830000-0000-4000-8000-000000000006';
  bad jsonb;
BEGIN
  FOREACH bad IN ARRAY ARRAY['{}','{"rotationSlot":-1}','{"rotationSlot":"1"}','{"rotationSlot":1.5}',
    '{"rotationSlot":1234567890}','{"rotationSlot":0,"extra":1}','[]']::jsonb[] LOOP
    BEGIN
      PERFORM piggyvest_primary.read_credit_gap_ledger(integration,'staging',bad);
      RAISE EXCEPTION 'Malformed options were accepted: %', bad;
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  BEGIN
    PERFORM piggyvest_primary.read_credit_gap_ledger(integration,'production','{"rotationSlot":0}');
    RAISE EXCEPTION 'Wrong environment was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE piggyvest_primary.inflow_authorities SET enabled = false WHERE integration_id = integration;
  BEGIN
    PERFORM piggyvest_primary.read_credit_gap_ledger(integration,'staging','{"rotationSlot":0}');
    RAISE EXCEPTION 'Disabled authority was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$refused$;

-- Catalog: pinned SECURITY DEFINER; EXECUTE reaches only the evidence role.
DO $catalog$
DECLARE routine regprocedure:='piggyvest_primary.read_credit_gap_ledger(uuid,text,jsonb)'::regprocedure;
BEGIN
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = routine) THEN
    RAISE EXCEPTION 'read_credit_gap_ledger is not SECURITY DEFINER';
  END IF;
  IF (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = routine)
    IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
    RAISE EXCEPTION 'read_credit_gap_ledger search_path is not pinned';
  END IF;
  IF (SELECT array_agg(grantee_name ORDER BY grantee_name) FROM (
      SELECT DISTINCT CASE WHEN privilege.grantee = 0 THEN 'PUBLIC'
        ELSE grantee_role.rolname::text END AS grantee_name
      FROM pg_catalog.pg_proc routine_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(routine_row.proacl,
        pg_catalog.acldefault('f', routine_row.proowner))) privilege
      LEFT JOIN pg_catalog.pg_roles grantee_role ON grantee_role.oid = privilege.grantee
      WHERE routine_row.oid = routine AND privilege.privilege_type = 'EXECUTE'
        AND privilege.grantee <> routine_row.proowner) grantees)
    IS DISTINCT FROM ARRAY['piggyvest_primary_evidence'] THEN
    RAISE EXCEPTION 'read_credit_gap_ledger EXECUTE reaches roles beyond the evidence role';
  END IF;
END;
$catalog$;
ROLLBACK;

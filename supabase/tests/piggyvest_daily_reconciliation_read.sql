-- Contract tests for piggyvest_primary.read_daily_reconciliation: only stale
-- reserved/dispatched transfers are listed (oldest first), expected balances
-- count confirmed transfers only, the read changes nothing, a wrong binding,
-- disabled authority or malformed options are refused, and EXECUTE reaches
-- only the evidence role. Synthetic, transaction-local fixture.
BEGIN;
UPDATE piggyvest_primary.integrations SET executor_login = 'retired-' || id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.inflow_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;
INSERT INTO auth.users (id, email) VALUES
  ('f3820000-0000-4000-8000-000000000001', 'piggyvest-daily-recon@example.test');
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3820000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f3820000-0000-4000-8000-000000000002', 'f3820000-0000-4000-8000-000000000001',
   'piggyvest-daily-recon@example.test', 'PiggyVest Daily Recon Fixture', 'piggyvest-daily-recon-fixture');
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES
  ('f3820000-0000-4000-8000-000000000003', 'f3820000-0000-4000-8000-000000000002',
   'f3820000-0000-4000-8000-000000000001', 'piggyvest-daily-recon-customer@example.test');
INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity) VALUES
  ('f3820000-0000-4000-8000-000000000004', 'f3820000-0000-4000-8000-000000000002',
   'Synthetic savings product', 10000, 'active', 1);
INSERT INTO public.customer_savings_goals (
  id, merchant_id, customer_id, product_id, title, target_amount, current_amount,
  contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
  terms_accepted_at, non_withdrawable_accepted_at
) VALUES ('f3820000-0000-4000-8000-000000000005', 'f3820000-0000-4000-8000-000000000002',
   'f3820000-0000-4000-8000-000000000003', 'f3820000-0000-4000-8000-000000000004',
   'Synthetic reconciliation goal', 10000, 0, 1000, 'daily', current_date, current_date + 30,
   'manual', now(), now());
INSERT INTO piggyvest_primary.integrations
  (id, merchant_id, business_id, environment, executor_login, enabled)
VALUES ('f3820000-0000-4000-8000-000000000006', 'f3820000-0000-4000-8000-000000000002',
  'synthetic-recon-business', 'staging', SESSION_USER, true);
INSERT INTO piggyvest_primary.inflow_authorities (integration_id, executor_login, enabled)
VALUES ('f3820000-0000-4000-8000-000000000006', SESSION_USER, true);
INSERT INTO piggyvest_primary.onboarding_intents (
  id, integration_id, merchant_id, customer_id, user_id, request_fingerprint, state,
  provider_customer_id, provider_wallet_id
) VALUES ('f3820000-0000-4000-8000-000000000007', 'f3820000-0000-4000-8000-000000000006',
  'f3820000-0000-4000-8000-000000000002', 'f3820000-0000-4000-8000-000000000003',
  'f3820000-0000-4000-8000-000000000001', repeat('b', 64), 'accepted',
  'synthetic-recon-customer', 'synthetic-main-wallet');
INSERT INTO public.customer_wallets (id, customer_id, merchant_id) VALUES
  ('f3820000-0000-4000-8000-000000000008', 'f3820000-0000-4000-8000-000000000003',
   'f3820000-0000-4000-8000-000000000002');
INSERT INTO public.customer_wallet_transactions (
  id, wallet_id, customer_id, merchant_id, type, amount, balance_after, status
) VALUES ('f3820000-0000-4000-8000-000000000009', 'f3820000-0000-4000-8000-000000000008',
  'f3820000-0000-4000-8000-000000000003', 'f3820000-0000-4000-8000-000000000002',
  'adjustment', 10, 10, 'completed');
-- One pending transfer per goal: a unique index allows a single reserved or
-- dispatched transfer per intent and goal, so each pending row gets its own goal.
INSERT INTO public.customer_savings_goals (
  id, merchant_id, customer_id, product_id, title, target_amount, current_amount,
  contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
  terms_accepted_at, non_withdrawable_accepted_at
)
SELECT g.id::uuid, 'f3820000-0000-4000-8000-000000000002', 'f3820000-0000-4000-8000-000000000003',
  'f3820000-0000-4000-8000-000000000004', 'Synthetic reconciliation goal ' || g.id, 10000, 0, 1000,
  'daily', current_date, current_date + 30, 'manual', now(), now()
FROM (VALUES ('f3820000-0000-4000-8000-0000000000b4'), ('f3820000-0000-4000-8000-0000000000b5'),
  ('f3820000-0000-4000-8000-0000000000b7')) AS g(id);
-- Two confirmed (one wallet), one stale dispatched, one fresh dispatched, one
-- stale reserved, one cancelled.
INSERT INTO piggyvest_primary.savings_operations (
  id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
  destination_wallet_id, reference, state, wallet_transaction_id, created_at, dispatched_at
)
SELECT v.id::uuid, 'f3820000-0000-4000-8000-000000000006', 'f3820000-0000-4000-8000-000000000007',
  v.goal::uuid, v.amount, 'synthetic-main-wallet', v.destination,
  v.reference, v.state, 'f3820000-0000-4000-8000-000000000009', now() - v.age, v.dispatched
FROM (VALUES
  ('f3820000-0000-4000-8000-0000000000a1', 'f3820000-0000-4000-8000-000000000005', 1000, 'synthetic-goal-a', 'recon-confirmed-1', 'confirmed', interval '3 days', now() - interval '3 days'),
  ('f3820000-0000-4000-8000-0000000000a2', 'f3820000-0000-4000-8000-000000000005', 500, 'synthetic-goal-a', 'recon-confirmed-2', 'confirmed', interval '2 days', NULL::timestamptz),
  ('f3820000-0000-4000-8000-0000000000a3', 'f3820000-0000-4000-8000-000000000005', 700, 'synthetic-goal-b', 'recon-stale-dispatched', 'dispatched', interval '2 hours', now() - interval '1 hour'),
  ('f3820000-0000-4000-8000-0000000000a4', 'f3820000-0000-4000-8000-0000000000b4', 300, 'synthetic-goal-b', 'recon-fresh-dispatched', 'dispatched', interval '1 minute', now() - interval '1 minute'),
  ('f3820000-0000-4000-8000-0000000000a5', 'f3820000-0000-4000-8000-0000000000b5', 200, 'synthetic-goal-b', 'recon-stale-reserved', 'reserved', interval '5 hours', NULL::timestamptz),
  ('f3820000-0000-4000-8000-0000000000a6', 'f3820000-0000-4000-8000-000000000005', 100, 'synthetic-goal-c', 'recon-cancelled', 'cancelled', interval '9 hours', NULL::timestamptz),
  -- Re-driven: dispatch time refreshed a minute ago, but reserved 3 days ago.
  ('f3820000-0000-4000-8000-0000000000a7', 'f3820000-0000-4000-8000-0000000000b7', 400, 'synthetic-goal-b', 'recon-redriven-dispatched', 'dispatched', interval '3 days', now() - interval '1 minute')
) AS v(id, goal, amount, destination, reference, state, age, dispatched);

DO $read$
DECLARE
  integration uuid:='f3820000-0000-4000-8000-000000000006';
  snapshot jsonb;
  before_states text;
BEGIN
  SELECT string_agg(id::text||state||COALESCE(dispatched_at::text,''),',' ORDER BY id) INTO before_states
    FROM piggyvest_primary.savings_operations;
  snapshot:=piggyvest_primary.read_daily_reconciliation(integration,'staging','{"staleAfterSeconds":900,"rotationSlot":0}');
  IF snapshot->>'businessId' IS DISTINCT FROM 'synthetic-recon-business'
    OR (snapshot->>'stuckTotal')::int IS DISTINCT FROM 3
    OR (snapshot->>'walletsTotal')::int IS DISTINCT FROM 1
    OR (snapshot->>'stuckDeferred')::int IS DISTINCT FROM 0
    OR (snapshot->>'walletsDeferred')::int IS DISTINCT FROM 0
    OR (snapshot->>'staleAfterSeconds')::int IS DISTINCT FROM 900 THEN
    RAISE EXCEPTION 'Unexpected reconciliation header: %', snapshot;
  END IF;
  -- Oldest first, aged from when the money was reserved: the re-driven row
  -- (3 days, dispatch refreshed a minute ago) leads, then 5 hours, then 2 hours.
  IF (SELECT array_agg(item->>'reference') FROM jsonb_array_elements(snapshot->'stuck') item)
    IS DISTINCT FROM ARRAY['recon-redriven-dispatched','recon-stale-reserved','recon-stale-dispatched'] THEN
    RAISE EXCEPTION 'Wrong stuck list: %', snapshot->'stuck';
  END IF;
  IF snapshot->'wallets' IS DISTINCT FROM
    '[{"walletId":"synthetic-goal-a","expectedKobo":1500}]'::jsonb THEN
    RAISE EXCEPTION 'Wrong expected balances: %', snapshot->'wallets';
  END IF;
  IF (SELECT string_agg(id::text||state||COALESCE(dispatched_at::text,''),',' ORDER BY id)
      FROM piggyvest_primary.savings_operations) IS DISTINCT FROM before_states THEN
    RAISE EXCEPTION 'Reconciliation read changed savings operations';
  END IF;
  -- A one-day cutoff lists only the 3-day-old re-driven transfer; the fresh one never appears.
  snapshot:=piggyvest_primary.read_daily_reconciliation(integration,'staging','{"staleAfterSeconds":86400,"rotationSlot":0}');
  IF (SELECT array_agg(item->>'reference') FROM jsonb_array_elements(snapshot->'stuck') item)
    IS DISTINCT FROM ARRAY['recon-redriven-dispatched'] OR (snapshot->>'stuckTotal')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'One-day cutoff listed transfers: %', snapshot;
  END IF;
  -- rotationSlot is optional: the single-key form is valid and reads slot 0.
  snapshot:=piggyvest_primary.read_daily_reconciliation(integration,'staging','{"staleAfterSeconds":900}');
  IF (snapshot->>'stuckTotal')::int IS DISTINCT FROM 3
    OR (SELECT array_agg(item->>'reference') FROM jsonb_array_elements(snapshot->'stuck') item)
      IS DISTINCT FROM ARRAY['recon-redriven-dispatched','recon-stale-reserved','recon-stale-dispatched'] THEN
    RAISE EXCEPTION 'Single-key options did not read slot 0: %', snapshot;
  END IF;
END;
$read$;

DO $refused$
DECLARE
  integration uuid:='f3820000-0000-4000-8000-000000000006';
  bad jsonb;
BEGIN
  FOREACH bad IN ARRAY ARRAY['{}','{"rotationSlot":0}',
    '{"staleAfterSeconds":"900","rotationSlot":0}','{"staleAfterSeconds":900,"rotationSlot":0,"extra":1}',
    '{"staleAfterSeconds":900,"extra":1}','{"staleAfterSeconds":900,"rotationSlot":"x"}','{"staleAfterSeconds":900,"rotationSlot":"0"}',
    '{"staleAfterSeconds":900,"rotationSlot":-1}','{"staleAfterSeconds":900,"rotationSlot":1.5}',
    '{"staleAfterSeconds":900,"rotationSlot":null}','{"staleAfterSeconds":900,"rotationSlot":1000000000}',
    '{"staleAfterSeconds":9.5,"rotationSlot":0}','{"staleAfterSeconds":59,"rotationSlot":0}',
    '{"staleAfterSeconds":604801,"rotationSlot":0}','{"staleAfterSeconds":null,"rotationSlot":0}',
    '{"staleAfterSeconds":-900,"rotationSlot":0}','[]','null']::jsonb[] LOOP
    BEGIN
      PERFORM piggyvest_primary.read_daily_reconciliation(integration,'staging',bad);
      RAISE EXCEPTION 'Malformed options % were accepted', bad;
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  BEGIN
    PERFORM piggyvest_primary.read_daily_reconciliation(integration,'staging',NULL);
    RAISE EXCEPTION 'NULL options were accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- Wrong environment, unknown integration, and a mismatched or disabled binding.
  BEGIN
    PERFORM piggyvest_primary.read_daily_reconciliation(integration,'production','{"staleAfterSeconds":900,"rotationSlot":0}');
    RAISE EXCEPTION 'Wrong environment was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary.read_daily_reconciliation('00000000-0000-4000-8000-000000000000','staging','{"staleAfterSeconds":900,"rotationSlot":0}');
    RAISE EXCEPTION 'Unknown integration was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE piggyvest_primary.inflow_authorities SET executor_login = SESSION_USER || '_other'
    WHERE integration_id = integration;
  BEGIN
    PERFORM piggyvest_primary.read_daily_reconciliation(integration,'staging','{"staleAfterSeconds":900,"rotationSlot":0}');
    RAISE EXCEPTION 'Another login was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE piggyvest_primary.inflow_authorities SET executor_login = SESSION_USER, enabled = false
    WHERE integration_id = integration;
  BEGIN
    PERFORM piggyvest_primary.read_daily_reconciliation(integration,'staging','{"staleAfterSeconds":900,"rotationSlot":0}');
    RAISE EXCEPTION 'Disabled authority was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE piggyvest_primary.inflow_authorities SET enabled = true WHERE integration_id = integration;
  UPDATE piggyvest_primary.integrations SET enabled = false WHERE id = integration;
  BEGIN
    PERFORM piggyvest_primary.read_daily_reconciliation(integration,'staging','{"staleAfterSeconds":900,"rotationSlot":0}');
    RAISE EXCEPTION 'Disabled integration was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$refused$;

-- Catalog: pinned SECURITY DEFINER; EXECUTE reaches only the evidence role.
DO $catalog$
DECLARE routine regprocedure:='piggyvest_primary.read_daily_reconciliation(uuid,text,jsonb)'::regprocedure;
BEGIN
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = routine) THEN
    RAISE EXCEPTION 'read_daily_reconciliation is not SECURITY DEFINER';
  END IF;
  IF (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = routine)
    IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
    RAISE EXCEPTION 'read_daily_reconciliation search_path is not pinned';
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
    RAISE EXCEPTION 'read_daily_reconciliation EXECUTE reaches roles beyond the evidence role';
  END IF;
  IF pg_catalog.has_function_privilege('anon', routine, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', routine, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', routine, 'EXECUTE') THEN
    RAISE EXCEPTION 'read_daily_reconciliation is executable by a client role';
  END IF;
END;
$catalog$;
ROLLBACK;

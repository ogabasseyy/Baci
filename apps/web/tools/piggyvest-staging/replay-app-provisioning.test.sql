\set ON_ERROR_STOP on
-- Synthetic scratch-PostgreSQL regression for replay-app-provisioning.sql.
--
-- Usage:
--   psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v expected_system_identifier="$(psql "$SCRATCH_DATABASE_URL" -tAc \
--       'SELECT system_identifier FROM pg_control_system()')" \
--     -f apps/web/tools/piggyvest-staging/replay-app-provisioning.test.sql
--
-- This fixture is synthetic only. It requires a disposable cluster and rolls
-- back its assertions. Never point it at a staging database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin SUPERUSER NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$bootstrap$;

CREATE TABLE public.merchants (
  id uuid PRIMARY KEY
);

CREATE TABLE public.customers (
  id uuid PRIMARY KEY,
  email text DEFAULT 'synthetic@example.test',
  merchant_id uuid NOT NULL REFERENCES public.merchants(id)
);

INSERT INTO public.merchants (id)
VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO public.customers (id, merchant_id)
VALUES (
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001'
);

SET ROLE supabase_admin;
\ir replay-app-provisioning.sql
RESET ROLE;

BEGIN;

DO $test$
DECLARE
  first_outcome text;
  duplicate_outcome text;
  system_id text;
  mapping record;
BEGIN
  SET LOCAL ROLE pvb_staging_app_worker;

  SELECT public.piggyvest_staging_system_id() INTO system_id;
  IF system_id IS DISTINCT FROM
    (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) THEN
    RAISE EXCEPTION 'App identity RPC returned the wrong system identifier';
  END IF;

  SELECT customer_id, merchant_id, piggyvest_customer_id, wallet_id INTO mapping
  FROM public.piggyvest_plan_wallets
  WHERE piggyvest_customer_id = 'c096507d-dc32-45d2-9c01-871a27abfd10'
    AND wallet_id = '01M2T3PCEDE2MGF2S7Y5T49H01';
  IF NOT FOUND
    OR mapping.customer_id <> '10000000-0000-4000-8000-000000000002'::uuid
    OR mapping.merchant_id <> '10000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'Worker cannot read the verified synthetic mapping';
  END IF;

  first_outcome := public.recognize_piggyvest_staging_inflow(
    'synthetic-txn-001', 'synthetic-data-001', 'synthetic-event-001',
    'c096507d-dc32-45d2-9c01-871a27abfd10',
    '01M2T3PCEDE2MGF2S7Y5T49H01', 10000, 0,
    'synthetic-reference-001', NULL,
    '2026-09-19T00:00:00Z'::timestamptz
  );
  IF first_outcome <> 'recognized' THEN
    RAISE EXCEPTION 'First inflow outcome was %, expected recognized', first_outcome;
  END IF;

  duplicate_outcome := public.recognize_piggyvest_staging_inflow(
    'synthetic-txn-001', 'synthetic-data-002', 'synthetic-event-002',
    'c096507d-dc32-45d2-9c01-871a27abfd10',
    '01M2T3PCEDE2MGF2S7Y5T49H01', 10000, 0,
    'synthetic-reference-002', 'synthetic-session-002',
    '2026-09-19T00:01:00Z'::timestamptz
  );
  IF duplicate_outcome <> 'duplicate' THEN
    RAISE EXCEPTION 'Identical financial inflow outcome was %, expected duplicate', duplicate_outcome;
  END IF;

  FOREACH first_outcome IN ARRAY ARRAY['9999', '10001'] LOOP
    BEGIN
      PERFORM public.recognize_piggyvest_staging_inflow(
        'synthetic-txn-001', 'synthetic-data-conflict', 'synthetic-event-conflict',
        'c096507d-dc32-45d2-9c01-871a27abfd10',
        '01M2T3PCEDE2MGF2S7Y5T49H01', first_outcome::bigint, 0,
        'synthetic-reference-conflict', 'synthetic-session-conflict',
        '2026-09-19T00:02:00Z'::timestamptz
      );
      RAISE EXCEPTION 'Conflicting amount was accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  BEGIN
    PERFORM public.recognize_piggyvest_staging_inflow(
      'synthetic-txn-001', 'synthetic-data-conflict', 'synthetic-event-conflict',
      'other-provider-customer', '01M2T3PCEDE2MGF2S7Y5T49H01', 10000, 0,
      'synthetic-reference-conflict', 'synthetic-session-conflict',
      '2026-09-19T00:02:00Z'::timestamptz
    );
    RAISE EXCEPTION 'Conflicting provider customer was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    PERFORM public.recognize_piggyvest_staging_inflow(
      'synthetic-txn-001', 'synthetic-data-conflict', 'synthetic-event-conflict',
      'c096507d-dc32-45d2-9c01-871a27abfd10', 'other-provider-wallet', 10000, 0,
      'synthetic-reference-conflict', 'synthetic-session-conflict',
      '2026-09-19T00:02:00Z'::timestamptz
    );
    RAISE EXCEPTION 'Conflicting provider wallet was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.piggyvest_inflow_credits
      (provider_transaction_id, event_data_id, event_id, customer_id, wallet_id,
       amount_kobo, fee_kobo, reference, session_id, credited_at)
    VALUES ('direct-worker-write', 'data', 'event', 'customer', 'wallet', 1, 0,
      'reference', 'session', clock_timestamp());
    RAISE EXCEPTION 'Worker can write inflows without the recognition RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;

RESET ROLE;

DO $audit$
DECLARE
  unsafe_object text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'pvb_staging_app_worker'
      AND (rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR
        rolcreaterole OR rolcreatedb OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'App worker role has unsafe attributes';
  END IF;
  IF pg_has_role('service_role', 'pvb_staging_app_worker', 'MEMBER') THEN
    RAISE EXCEPTION 'service_role can assume the app worker role';
  END IF;
  IF NOT pg_has_role('authenticator', 'pvb_staging_app_worker', 'MEMBER') THEN
    RAISE EXCEPTION 'PostgREST cannot assume the app worker role';
  END IF;
  IF has_table_privilege('pvb_staging_app_worker',
      'public.piggyvest_inflow_credits', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'App worker has direct inflow write privileges';
  END IF;
  SELECT format('%I.%I', namespace.nspname, relation.relname) INTO unsafe_object
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND namespace.nspname !~ '^pg_toast'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    AND relation.oid NOT IN (
      'public.piggyvest_plan_wallets'::regclass,
      'public.piggyvest_inflow_credits'::regclass)
    AND (has_table_privilege('pvb_staging_app_worker', relation.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege('pvb_staging_app_worker', relation.oid,
        'SELECT,INSERT,UPDATE,REFERENCES'))
  LIMIT 1;
  IF unsafe_object IS NOT NULL THEN
    RAISE EXCEPTION 'App worker reaches outside replay app tables: %', unsafe_object;
  END IF;
END
$audit$;

ROLLBACK;

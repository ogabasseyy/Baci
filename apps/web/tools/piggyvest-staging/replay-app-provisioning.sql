\set ON_ERROR_STOP on
-- Isolated application-database provisioning for PiggyVest receipt replay.
--
-- Apply only as superuser `supabase_admin` to the isolated staging APP
-- cluster whose PostgreSQL system identifier is 7685292944002592802:
--
--   psql "$PVB_STAGING_APP_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v expected_system_identifier=7685292944002592802 \
--     -f apps/web/tools/piggyvest-staging/replay-app-provisioning.sql
--
-- The receipt cluster is a separate target (7686901100561231906) and must
-- never be supplied here. This installer creates no credentials and does not
-- activate replay. It composes the reviewed mapping/inflow migrations, verifies
-- an existing synthetic customer/merchant relationship, and grants the replay
-- worker only mapping reads, inflow recognition, and the identity RPC.

\if :{?expected_system_identifier}
\else
DO $missing_identifier$
BEGIN
  RAISE EXCEPTION 'Required psql variable expected_system_identifier is absent';
END
$missing_identifier$;
\endif

BEGIN;
SET LOCAL pvb_staging.expected_system_identifier = :'expected_system_identifier';

DO $guard$
BEGIN
  IF current_user <> 'supabase_admin'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = current_user AND rolsuper
    ) THEN
    RAISE EXCEPTION 'Apply replay app provisioning as superuser supabase_admin';
  END IF;
  IF current_setting('pvb_staging.expected_system_identifier') !~ '^[0-9]{1,20}$' THEN
    RAISE EXCEPTION 'Invalid expected_system_identifier';
  END IF;
  IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system())
    <> current_setting('pvb_staging.expected_system_identifier') THEN
    RAISE EXCEPTION 'Refusing database system identifier mismatch';
  END IF;
END
$guard$;

\ir ../../../../supabase/migrations/20260918120000_piggyvest_plan_wallets.sql
\ir ../../../../supabase/migrations/20260918140000_piggyvest_inflow_credits.sql
\ir ../../../../supabase/migrations/20260918210000_piggyvest_inflow_session_nullable.sql

DO $fixture$
DECLARE
  fixture_customer_id constant uuid := '10000000-0000-4000-8000-000000000002';
  fixture_merchant_id constant uuid := '10000000-0000-4000-8000-000000000001';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.customers AS customer
    JOIN public.merchants AS merchant ON merchant.id = customer.merchant_id
    WHERE customer.id = fixture_customer_id
      AND customer.merchant_id = fixture_merchant_id
      AND split_part(lower(customer.email), '@', 2) IN ('example.test', 'example.invalid', 'savings.example.invalid')
  ) THEN
    RAISE EXCEPTION 'Required synthetic customer/merchant fixture relationship is absent';
  END IF;
END
$fixture$;

INSERT INTO public.piggyvest_plan_wallets (
  customer_id,
  merchant_id,
  piggyvest_customer_id,
  wallet_id,
  subaccount_name,
  status
)
VALUES (
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  'c096507d-dc32-45d2-9c01-871a27abfd10',
  '01M2T3PCEDE2MGF2S7Y5T49H01',
  'staging-customer-10000000-0000-4000-8000-000000000002',
  'ready'
)
ON CONFLICT (customer_id, merchant_id) DO UPDATE
SET updated_at = public.piggyvest_plan_wallets.updated_at
WHERE public.piggyvest_plan_wallets.piggyvest_customer_id = EXCLUDED.piggyvest_customer_id
  AND public.piggyvest_plan_wallets.wallet_id = EXCLUDED.wallet_id
  AND public.piggyvest_plan_wallets.subaccount_name = EXCLUDED.subaccount_name
  AND public.piggyvest_plan_wallets.status = EXCLUDED.status;

DO $mapping_conflict$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.piggyvest_plan_wallets
    WHERE customer_id = '10000000-0000-4000-8000-000000000002'
      AND merchant_id = '10000000-0000-4000-8000-000000000001'
      AND piggyvest_customer_id = 'c096507d-dc32-45d2-9c01-871a27abfd10'
      AND wallet_id = '01M2T3PCEDE2MGF2S7Y5T49H01'
      AND subaccount_name = 'staging-customer-10000000-0000-4000-8000-000000000002'
      AND status = 'ready'
  ) THEN
    RAISE EXCEPTION 'Synthetic mapping conflicts with an existing mapping';
  END IF;
END
$mapping_conflict$;

DO $worker_role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pvb_staging_app_worker'
  ) THEN
    CREATE ROLE pvb_staging_app_worker
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$worker_role$;

ALTER ROLE pvb_staging_app_worker
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
DO $service_role_membership$
BEGIN
  IF pg_has_role('service_role', 'pvb_staging_app_worker', 'MEMBER') THEN
    REVOKE pvb_staging_app_worker FROM service_role;
  END IF;
END
$service_role_membership$;
GRANT pvb_staging_app_worker TO authenticator;

\ir replay-app-rpcs.sql

DO $audit$
DECLARE
  unsafe_object text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'pvb_staging_app_worker'
      AND (rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR
        rolcreaterole OR rolcreatedb OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'Replay app worker has unsafe role attributes';
  END IF;
  IF pg_has_role('service_role', 'pvb_staging_app_worker', 'MEMBER') THEN
    RAISE EXCEPTION 'service_role must not assume replay app worker';
  END IF;
  IF has_table_privilege('pvb_staging_app_worker',
      'public.piggyvest_inflow_credits',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege('pvb_staging_app_worker',
      'public.piggyvest_inflow_credits', 'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'Replay app worker has direct inflow table access';
  END IF;
  IF has_table_privilege('pvb_staging_app_worker',
      'public.piggyvest_plan_wallets',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'Replay app worker can mutate plan-wallet mappings';
  END IF;
  SELECT format('%I.%I', namespace.nspname, relation.relname) INTO unsafe_object
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
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
    RAISE EXCEPTION 'Replay app worker reaches outside replay tables: %', unsafe_object;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND routine.prosecdef
      AND has_function_privilege('pvb_staging_app_worker', routine.oid, 'EXECUTE')
      AND routine.oid <> 'public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamp with time zone)'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Replay app worker can execute an unapproved security-definer function';
  END IF;
END
$audit$;

NOTIFY pgrst, 'reload schema';
COMMIT;

\if :{?piggyvest_projection_test}
\else
BEGIN;
\endif

SELECT pg_catalog.set_config('baci.piggyvest_projection_test', 'off', true)
WHERE pg_catalog.current_setting('baci.piggyvest_projection_test', true) IS NULL;

DO $install_guard$
DECLARE
  v_system_identifier text;
  v_test_mode boolean := pg_catalog.current_setting('baci.piggyvest_projection_test', true) = 'on';
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
    OR current_database() <> (CASE WHEN v_test_mode THEN 'piggyvest_goal_funding_scratch' ELSE 'postgres' END) THEN
    RAISE EXCEPTION 'PiggyVest goal projection install context refused';
  END IF;
  SELECT system_identifier::text INTO v_system_identifier
  FROM pg_catalog.pg_control_system();
  IF v_test_mode THEN
    IF v_system_identifier = '7685292944002592802' THEN
      RAISE EXCEPTION 'refusing staging cluster in projection test mode';
    END IF;
  ELSIF v_system_identifier <> '7685292944002592802'
    OR extract(epoch FROM clock_timestamp()) >= 1790697550 THEN
    RAISE EXCEPTION 'staging cluster identity or fixed lease refused';
  END IF;
  IF to_regclass('public.piggyvest_inflow_credits') IS NULL
    OR to_regclass('piggyvest_staging.wallet_goal_mappings') IS NULL
    OR to_regclass('public.customer_savings_contributions') IS NULL
    OR to_regclass('public.customer_savings_goals') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pvb_staging_app_worker') THEN
    RAISE EXCEPTION 'required staging projection objects or restricted worker are missing';
  END IF;
END
$install_guard$;

DO $source_type$
DECLARE
  v_definition text;
  v_normalized text;
  v_old_definition constant text := 'checksource_type=anyarray[''wallet'',''paystack_authorization'',''manual_adjustment'']';
  v_new_definition constant text := 'checksource_type=anyarray[''wallet'',''paystack_authorization'',''manual_adjustment'',''piggyvest_inflow'']';
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
  INTO v_definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.customer_savings_contributions'::regclass
    AND constraint_row.conname = 'customer_savings_contributions_source_type_check'
    AND constraint_row.contype = 'c';
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'expected customer savings source constraint missing';
  END IF;
  v_normalized := pg_catalog.regexp_replace(
    pg_catalog.lower(v_definition), '[[:space:]()]|::text(\[\])?', '', 'g'
  );
  IF v_normalized <> v_new_definition THEN
    IF v_normalized <> v_old_definition THEN
      RAISE EXCEPTION 'customer savings source constraint changed unexpectedly';
    END IF;
    ALTER TABLE public.customer_savings_contributions
      DROP CONSTRAINT customer_savings_contributions_source_type_check;
    ALTER TABLE public.customer_savings_contributions
      ADD CONSTRAINT customer_savings_contributions_source_type_check
      CHECK (source_type = ANY (ARRAY[
        'wallet', 'paystack_authorization', 'manual_adjustment', 'piggyvest_inflow'
      ]::text[]));
  END IF;
END
$source_type$;

DO $session_id_nullability$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.piggyvest_inflow_credits'::regclass
      AND attname = 'session_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'expected provider session_id evidence column missing';
  END IF;
  ALTER TABLE public.piggyvest_inflow_credits ALTER COLUMN session_id DROP NOT NULL;
END
$session_id_nullability$;

\ir projection-storage.sql
\ir projection-functions.sql

REVOKE ALL ON FUNCTION public.recognize_piggyvest_staging_inflow(
  text, text, text, text, text, bigint, bigint, text, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role, pvb_staging_app_worker;
GRANT EXECUTE ON FUNCTION public.recognize_piggyvest_staging_inflow(
  text, text, text, text, text, bigint, bigint, text, text, timestamptz
) TO pvb_staging_app_worker;
REVOKE ALL ON FUNCTION public.resolve_piggyvest_staging_goal_mapping(text, text)
  FROM PUBLIC, anon, authenticated, service_role, pvb_staging_app_worker;
GRANT EXECUTE ON FUNCTION public.resolve_piggyvest_staging_goal_mapping(text, text)
  TO pvb_staging_app_worker;

DO $privilege_audit$
BEGIN
  IF NOT pg_catalog.has_function_privilege('pvb_staging_app_worker',
      'public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('pvb_staging_app_worker',
      'public.resolve_piggyvest_staging_goal_mapping(text,text)', 'EXECUTE')
    OR pg_catalog.has_table_privilege('pvb_staging_app_worker',
      'piggyvest_staging.goal_inflow_projections', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    OR pg_catalog.has_table_privilege('pvb_staging_app_worker',
      'piggyvest_staging.wallet_goal_mappings', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'PiggyVest goal projection privilege boundary refused';
  END IF;
  IF pg_catalog.has_function_privilege('anon',
      'public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',
      'public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role',
      'public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon',
      'public.resolve_piggyvest_staging_goal_mapping(text,text)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',
      'public.resolve_piggyvest_staging_goal_mapping(text,text)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role',
      'public.resolve_piggyvest_staging_goal_mapping(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PiggyVest goal projection RPC is exposed outside its worker role';
  END IF;
END
$privilege_audit$;

\if :{?piggyvest_projection_test}
\else
COMMIT;
\endif

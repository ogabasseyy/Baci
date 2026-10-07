BEGIN;
SET LOCAL log_statement='none';
SET LOCAL log_min_error_statement='panic';
SET LOCAL log_min_messages='panic';
SET LOCAL log_min_duration_statement=-1;
SET LOCAL log_min_duration_sample=-1;
SET LOCAL log_transaction_sample_rate=0;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';
SET LOCAL synchronous_commit=on;
SET LOCAL password_encryption='scram-sha-256';
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('prefunded-card-runtime-credentials-owner-v2',0));
DO $audit$
BEGIN
  IF current_setting('pgaudit.log',true) IS DISTINCT FROM NULL
    AND current_setting('pgaudit.log',true) NOT IN ('','none')
  THEN RAISE EXCEPTION 'runtime credentials audit logging refused'; END IF;
END
$audit$;
CREATE TEMP TABLE runtime_credentials_owner_input(value jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO runtime_credentials_owner_input VALUES(__OWNER_INPUT__::jsonb);

DO $preflight$
BEGIN
  IF to_regclass('piggyvest_staging.integrations') IS NULL
    OR to_regclass('prefunded_card.treasury_bindings') IS NULL
    OR to_regclass('prefunded_card.treasury_identities') IS NULL
    OR to_regclass('prefunded_card.operations') IS NULL
    OR to_regclass('prefunded_card.checkout_intents') IS NULL
    OR to_regclass('prefunded_card.credit_routes') IS NULL
    OR to_regclass('public.customers') IS NULL
    OR to_regclass('public.customer_savings_goals') IS NULL
    OR to_regclass('piggyvest_staging.wallet_goal_mappings') IS NULL
    OR to_regclass('piggyvest_savings_ledger.bindings') IS NULL
  THEN RAISE EXCEPTION 'runtime credentials foundation refused'; END IF;
END
$preflight$;

LOCK TABLE piggyvest_staging.integrations,prefunded_card.treasury_bindings,
  prefunded_card.treasury_identities,prefunded_card.operations,
  prefunded_card.checkout_intents,prefunded_card.credit_routes,public.customers,
  public.customer_savings_goals,piggyvest_staging.wallet_goal_mappings,
  piggyvest_savings_ledger.bindings IN SHARE MODE;

DO $runtime_credentials$
DECLARE
  input jsonb;
  identity jsonb;
  database_oid oid;
  proof_digest text;
  role_name text;
  password_key text;
  logins constant text[]:=ARRAY['prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence'];
  capabilities constant text[]:=ARRAY['prefunded_treasury_ledger_worker','prefunded_card_authorization_reader','prefunded_card_authorization_provisioner'];
  executors constant text[]:=ARRAY['prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence','prefunded_treasury_ledger_worker','prefunded_card_authorization_reader','prefunded_card_authorization_provisioner'];
BEGIN
  SELECT value INTO STRICT input FROM runtime_credentials_owner_input;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object'
    OR jsonb_typeof(input->'systemIdentifier') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'databaseName') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'integrationId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'merchantId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'treasuryBindingId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'businessId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'sourceWalletId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'openingAvailableKobo') IS DISTINCT FROM 'number'
    OR jsonb_typeof(input->'expiresAt') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'mode') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'credentialProof') IS DISTINCT FROM 'string'
    OR input->>'systemIdentifier' IS DISTINCT FROM '7685292944002592802'
    OR input->>'databaseName' IS DISTINCT FROM 'postgres'
    OR input->>'integrationId' IS DISTINCT FROM 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'
    OR input->>'merchantId' IS DISTINCT FROM '10000000-0000-4000-8000-000000000001'
    OR input->>'treasuryBindingId' IS DISTINCT FROM 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'
    OR input->>'businessId' IS DISTINCT FROM '01M2381RG34HQJMHQKE7DWDACR'
    OR input->>'sourceWalletId' IS DISTINCT FROM '01M238A0V75387H4HZ15YFWGX3'
    OR input->>'openingAvailableKobo' IS DISTINCT FROM '10000'
    OR input->>'expiresAt' IS DISTINCT FROM '2026-09-29T15:59:10Z'
    OR NOT COALESCE(input->>'credentialProof' ~ '^[A-Za-z0-9_-]{64}$',false)
    OR current_database() IS DISTINCT FROM 'postgres' OR session_user IS DISTINCT FROM 'postgres'
    OR current_user IS DISTINCT FROM session_user
    OR NOT COALESCE((SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=session_user),false)
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IS DISTINCT FROM '7685292944002592802'
    OR clock_timestamp()>='2026-09-29T15:59:10Z'::timestamptz
  THEN RAISE EXCEPTION 'runtime credentials owner input refused'; END IF;

  IF input->>'mode'='initial' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(input))<>14 OR NOT input ?& ARRAY['systemIdentifier','databaseName','integrationId','merchantId','treasuryBindingId','businessId','sourceWalletId','openingAvailableKobo','expiresAt','mode','credentialProof','treasuryPassword','authorizerPassword','evidencePassword']
      OR jsonb_typeof(input->'treasuryPassword') IS DISTINCT FROM 'string'
      OR jsonb_typeof(input->'authorizerPassword') IS DISTINCT FROM 'string'
      OR jsonb_typeof(input->'evidencePassword') IS DISTINCT FROM 'string'
      OR NOT COALESCE(input->>'treasuryPassword' ~ '^[A-Za-z0-9_-]{64}$',false)
      OR NOT COALESCE(input->>'authorizerPassword' ~ '^[A-Za-z0-9_-]{64}$',false)
      OR NOT COALESCE(input->>'evidencePassword' ~ '^[A-Za-z0-9_-]{64}$',false)
      OR input->>'treasuryPassword' IS NOT DISTINCT FROM input->>'authorizerPassword'
      OR input->>'treasuryPassword' IS NOT DISTINCT FROM input->>'evidencePassword'
      OR input->>'authorizerPassword' IS NOT DISTINCT FROM input->>'evidencePassword'
    THEN RAISE EXCEPTION 'runtime credentials initial input refused'; END IF;
  ELSIF input->>'mode'='retry' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(input))<>11 OR NOT input ?& ARRAY['systemIdentifier','databaseName','integrationId','merchantId','treasuryBindingId','businessId','sourceWalletId','openingAvailableKobo','expiresAt','mode','credentialProof']
    THEN RAISE EXCEPTION 'runtime credentials retry input refused'; END IF;
  ELSE RAISE EXCEPTION 'runtime credentials mode refused'; END IF;

  IF to_regprocedure('prefunded_card.executor_system_identity()') IS NULL
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc function JOIN pg_catalog.pg_namespace namespace ON namespace.oid=function.pronamespace WHERE function.oid='prefunded_card.executor_system_identity()'::regprocedure AND (namespace.nspname<>'prefunded_card' OR pg_get_userbyid(function.proowner)<>'postgres' OR NOT function.prosecdef OR function.provolatile<>'s' OR function.prokind<>'f' OR function.prorettype<>'jsonb'::regtype OR function.proargtypes<>''::oidvector OR function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']))
    OR has_function_privilege('public','prefunded_card.executor_system_identity()','EXECUTE')
    OR EXISTS(SELECT 1 FROM unnest(logins) login(role_name) WHERE NOT has_function_privilege(login.role_name,'prefunded_card.executor_system_identity()','EXECUTE'))
  THEN RAISE EXCEPTION 'runtime credentials executor identity refused'; END IF;
  SELECT prefunded_card.executor_system_identity() INTO identity;
  IF identity IS DISTINCT FROM jsonb_build_object('database','postgres','login','postgres','systemIdentifier','7685292944002592802')
  THEN RAISE EXCEPTION 'runtime credentials executor identity refused'; END IF;

  PERFORM id FROM piggyvest_staging.integrations WHERE id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'::uuid AND enabled AND expected_provider_account_id='01M2381RG34HQJMHQKE7DWDACR' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'runtime credentials registry refused'; END IF;
  IF (SELECT count(*) FROM prefunded_card.treasury_bindings)<>1
    OR NOT EXISTS(SELECT 1 FROM prefunded_card.treasury_bindings WHERE id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'::uuid AND integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'::uuid AND merchant_id='10000000-0000-4000-8000-000000000001'::uuid AND expected_business_id='01M2381RG34HQJMHQKE7DWDACR' AND source_wallet_id='01M238A0V75387H4HZ15YFWGX3' AND currency='NGN' AND verified_available_kobo=10000 AND reserved_kobo=0 AND consumed_kobo=0 AND authorized_login='prefunded_treasury_operator' AND enabled)
  THEN RAISE EXCEPTION 'runtime credentials treasury binding refused'; END IF;
  IF (SELECT count(*) FROM prefunded_card.treasury_identities)<>1
    OR NOT EXISTS(SELECT 1 FROM prefunded_card.treasury_identities WHERE treasury_binding_id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'::uuid AND integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'::uuid AND merchant_id='10000000-0000-4000-8000-000000000001'::uuid AND expected_business_id='01M2381RG34HQJMHQKE7DWDACR' AND source_wallet_id='01M238A0V75387H4HZ15YFWGX3' AND authorized_login='prefunded_treasury_operator' AND opening_available_kobo=10000)
  THEN RAISE EXCEPTION 'runtime credentials treasury identity refused'; END IF;
  IF (SELECT count(*) FROM piggyvest_staging.wallet_goal_mappings mapping WHERE mapping.integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'::uuid AND mapping.merchant_id='10000000-0000-4000-8000-000000000001'::uuid AND mapping.customer_id='10000000-0000-4000-8000-000000000002'::uuid AND mapping.goal_id='430314fd-cd8b-4579-98d4-e9f345713dd6'::uuid)<>1
  THEN RAISE EXCEPTION 'runtime credentials customer scope refused'; END IF;
  PERFORM mapping.goal_id FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    JOIN public.customer_savings_goals goal ON goal.id=mapping.goal_id AND goal.customer_id=mapping.customer_id AND goal.merchant_id=mapping.merchant_id
    JOIN piggyvest_savings_ledger.bindings ledger ON ledger.integration_id=mapping.integration_id AND ledger.merchant_id=mapping.merchant_id AND ledger.customer_id=mapping.customer_id AND ledger.goal_id=mapping.goal_id
    WHERE mapping.integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'::uuid AND mapping.merchant_id='10000000-0000-4000-8000-000000000001'::uuid AND mapping.customer_id='10000000-0000-4000-8000-000000000002'::uuid AND mapping.goal_id='430314fd-cd8b-4579-98d4-e9f345713dd6'::uuid AND goal.goal_kind='legacy' AND goal.current_amount=100 AND goal.status='active' AND goal.completed_at IS NULL AND goal.cancelled_at IS NULL AND goal.spent_at IS NULL AND ledger.enabled AND ledger.authorized_login='prefunded_treasury_operator' FOR SHARE OF mapping,customer,goal,ledger;
  IF NOT FOUND THEN RAISE EXCEPTION 'runtime credentials customer scope refused'; END IF;
  IF EXISTS(SELECT 1 FROM prefunded_card.operations) OR EXISTS(SELECT 1 FROM prefunded_card.checkout_intents) OR EXISTS(SELECT 1 FROM prefunded_card.credit_routes)
  THEN RAISE EXCEPTION 'runtime credentials inactive baseline refused'; END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_authid WHERE rolname=ANY(logins))<>3
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_authid role WHERE role.rolname=ANY(logins) AND (role.rolsuper OR role.rolbypassrls OR role.rolcreaterole OR role.rolcreatedb OR role.rolreplication OR role.rolinherit OR role.rolconnlimit<>-1))
    OR (SELECT count(*) FROM pg_catalog.pg_authid WHERE rolname=ANY(capabilities))<>3
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_authid role WHERE role.rolname=ANY(capabilities) AND (role.rolcanlogin OR role.rolsuper OR role.rolbypassrls OR role.rolcreaterole OR role.rolcreatedb OR role.rolreplication OR role.rolconnlimit<>-1))
  THEN RAISE EXCEPTION 'runtime credentials role attributes refused'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members membership JOIN pg_catalog.pg_roles member ON member.oid=membership.member JOIN pg_catalog.pg_roles parent ON parent.oid=membership.roleid WHERE (member.rolname=ANY(executors) OR parent.rolname=ANY(executors)) AND NOT ((member.rolname='prefunded_treasury_operator' AND parent.rolname IN ('prefunded_treasury_ledger_worker','prefunded_card_authorization_reader')) OR (member.rolname='prefunded_authorizer' AND parent.rolname='prefunded_card_authorization_provisioner')))
    OR (SELECT count(*) FROM pg_catalog.pg_auth_members membership JOIN pg_catalog.pg_roles member ON member.oid=membership.member JOIN pg_catalog.pg_roles parent ON parent.oid=membership.roleid WHERE member.rolname=ANY(executors) OR parent.rolname=ANY(executors))<>3
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members membership JOIN pg_catalog.pg_roles member ON member.oid=membership.member JOIN pg_catalog.pg_roles parent ON parent.oid=membership.roleid WHERE (member.rolname=ANY(executors) OR parent.rolname=ANY(executors)) AND membership.admin_option)
  THEN RAISE EXCEPTION 'runtime credentials memberships refused'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace CROSS JOIN unnest(executors) executor(role_name) WHERE relation.relkind IN ('r','p','v','m','f') AND namespace.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND (has_table_privilege(executor.role_name,relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(executor.role_name,relation.oid::regclass::text,'SELECT,INSERT,UPDATE,REFERENCES')))
  THEN RAISE EXCEPTION 'runtime credentials data access refused'; END IF;

  SELECT oid INTO database_oid FROM pg_catalog.pg_database WHERE datname='postgres';
  proof_digest:=md5(input->>'credentialProof');
  IF input->>'mode'='initial' THEN
    IF EXISTS(SELECT 1 FROM pg_catalog.pg_authid role WHERE role.rolname=ANY(logins) AND (role.rolcanlogin OR role.rolpassword IS NOT NULL OR NOT (role.rolvaliduntil IS NULL OR role.rolvaliduntil='infinity'::timestamptz)))
      OR EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting setting JOIN pg_catalog.pg_roles role ON role.oid=setting.setrole WHERE role.rolname=ANY(logins))
    THEN RAISE EXCEPTION 'runtime credentials already provisioned or foreign state refused'; END IF;
    FOR role_name,password_key IN SELECT * FROM unnest(ARRAY['prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence'],ARRAY['treasuryPassword','authorizerPassword','evidencePassword'])
    LOOP
      BEGIN
        EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L VALID UNTIL %L',role_name,input->>password_key,input->>'expiresAt');
        EXECUTE format('ALTER ROLE %I IN DATABASE %I SET prefunded_card.runtime_credentials_proof TO %L',role_name,current_database(),proof_digest);
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'runtime credentials role mutation refused' USING ERRCODE='42501';
      END;
    END LOOP;
  ELSIF EXISTS(SELECT 1 FROM pg_catalog.pg_authid role WHERE role.rolname=ANY(logins) AND (NOT role.rolcanlogin OR role.rolpassword IS NULL OR role.rolvaliduntil IS DISTINCT FROM '2026-09-29T15:59:10Z'::timestamptz))
    OR (SELECT count(*) FROM pg_catalog.pg_db_role_setting setting JOIN pg_catalog.pg_roles role ON role.oid=setting.setrole WHERE role.rolname=ANY(logins) AND setting.setdatabase=database_oid AND setting.setconfig=ARRAY['prefunded_card.runtime_credentials_proof='||proof_digest])<>3
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting setting JOIN pg_catalog.pg_roles role ON role.oid=setting.setrole WHERE role.rolname=ANY(logins) AND (setting.setdatabase<>database_oid OR setting.setconfig<>ARRAY['prefunded_card.runtime_credentials_proof='||proof_digest]))
  THEN RAISE EXCEPTION 'runtime credentials retry proof refused'; END IF;
END
$runtime_credentials$;
COMMIT;

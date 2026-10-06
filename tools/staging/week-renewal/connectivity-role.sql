DO $renewal$
DECLARE
  worker_oid oid;
  password_before text;
  actual_function_count integer;
  function_set_matches boolean;
  target_expiry constant timestamptz := '2026-10-06 15:59:10+00';
BEGIN
  IF current_database() <> 'postgres' OR session_user <> 'postgres'
    OR current_user <> 'postgres' OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '7685292944002592802'
    OR current_setting('transaction_read_only') <> 'off' THEN
    RAISE EXCEPTION 'staging renewal database identity or transaction mode differs' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(20260930, 6010);

  LOCK TABLE pg_catalog.pg_authid, pg_catalog.pg_auth_members,
    pg_catalog.pg_proc, pg_catalog.pg_namespace IN SHARE ROW EXCLUSIVE MODE;

  SELECT oid, rolpassword INTO worker_oid, password_before
  FROM pg_catalog.pg_authid
  WHERE rolname = 'piggyvest_staging_provisioner'
    AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls
    AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication
    AND (rolvaliduntil IS NULL OR rolvaliduntil = target_expiry);

  IF worker_oid IS NULL THEN
    RAISE EXCEPTION 'staging provisioner role metadata differs' USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid = worker_oid OR member = worker_oid
  ) THEN
    RAISE EXCEPTION 'staging provisioner role memberships differ' USING ERRCODE = '40001';
  END IF;

  WITH expected(schema_name, function_name, arguments, definition_sha256) AS (
    VALUES
      ('piggyvest_staging', 'begin_provisioning_verification', 'p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_goal_id uuid, p_intent_id uuid, p_expected_business_id text', '8eae0806000c5c5fad6d639af63078a3a48cd721b58ead26a8fc1b16445f2835'),
      ('piggyvest_staging', 'claim_provisioning_intent', 'p_integration_id uuid, p_expected_merchant_id uuid, p_intent_id uuid, p_lease_seconds integer, p_expected_provider_account_id text, p_expected_provider_customer_id text', 'e608c9254f23ea2e7b10b629a13ec4b31ecae93c65b0af924d2fd7a432478634'),
      ('piggyvest_staging', 'confirm_provisioning_recovery', 'p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_goal_id uuid, p_intent_id uuid, p_expected_business_id text, p_verification_token uuid, p_wallet_id text, p_business_id text, p_currency text, p_wallet_status text', '3eb9f9a75e3c7d1598f60d811ff6ce09f0a89fabcc2fc9296e6f9991185e13be'),
      ('piggyvest_staging', 'expire_provisioning_claim', 'p_integration_id uuid, p_expected_merchant_id uuid, p_intent_id uuid', '45433cd6486175242105a933245ef6180b8ff35d575cb56261bddb09018eead3'),
      ('piggyvest_staging', 'observe_provisioning_recovery', 'p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_goal_id uuid, p_intent_id uuid, p_expected_business_id text, p_wallet_id text, p_business_id text, p_currency text, p_wallet_status text', '6aa656147741efcd35af19b6d4611754524470998cdf5fc07297aa45c7c90753'),
      ('piggyvest_staging', 'prepare_provisioning_intent', 'p_integration_id uuid, p_expected_merchant_id uuid, p_customer_id uuid, p_goal_id uuid, p_operation text, p_request_fingerprint bytea', '0b7aa3e95510436282fce9aa41d630795fa5a5c47b13aceb8d33b6d1703dff7a'),
      ('piggyvest_staging', 'read_provisioning_recovery', 'p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_goal_id uuid, p_intent_id uuid, p_expected_business_id text', '7afab7115782b6da0ae0866b29f3d3aee4be7a4c65aa78ee43f5016fece7a5f9'),
      ('piggyvest_staging', 'read_scoped_wallet_mapping', 'p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_goal_id uuid', '10915e25b30a6246c53d85c58605478f79a77c0afd888c9a2238089118647a8f'),
      ('piggyvest_staging', 'record_created_customer', 'p_integration_id uuid, p_merchant_id uuid, p_intent_id uuid, p_claim_token uuid, p_expected_business_id text, p_provider_customer_id text, p_provider_wallet_id text', '4291b55a7d0fc19dc7879fc25bb820e4997f765d0e90f9674843cc1c9b31872b'),
      ('piggyvest_staging', 'record_provisioning_result', 'p_integration_id uuid, p_expected_merchant_id uuid, p_intent_id uuid, p_claim_token uuid, p_result_code text, p_provider_customer_id text, p_provider_wallet_id text', '8b1ab5c454b01d2ae1ea533fbb9c82ffffd1e450c534792190fd6d93213c228c'),
      ('piggyvest_staging', 'resolve_wallet_mapping', 'p_integration_id uuid, p_provider_wallet_id text, p_provider_customer_id text', '10176125b9f10c104f09ef01e58d2271efb01c9542f3ab35eed0466974b2ce4c')
  ), actual AS (
    SELECT namespace.nspname AS schema_name, routine.proname AS function_name,
      pg_catalog.pg_get_function_identity_arguments(routine.oid) AS arguments,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.pg_get_functiondef(routine.oid), 'UTF8')), 'hex') AS definition_sha256,
      pg_catalog.pg_get_userbyid(routine.proowner) AS owner_name, routine.prosecdef
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname IN ('piggyvest_staging', 'piggyvest_savings_ledger')
      AND routine.prokind = 'f'
      AND pg_catalog.has_function_privilege(worker_oid, routine.oid, 'EXECUTE')
  )
  SELECT count(actual.schema_name), coalesce(bool_and(
    expected.schema_name IS NOT NULL AND actual.schema_name IS NOT NULL
    AND actual.definition_sha256 = expected.definition_sha256
    AND actual.owner_name = 'postgres' AND actual.prosecdef
  ), false)
  INTO actual_function_count, function_set_matches
  FROM expected FULL OUTER JOIN actual USING (schema_name, function_name, arguments);

  IF actual_function_count <> 11 OR NOT function_set_matches THEN
    RAISE EXCEPTION 'staging provisioner executable function set differs' USING ERRCODE = '40001';
  END IF;

  ALTER ROLE piggyvest_staging_provisioner VALID UNTIL '2026-10-06 15:59:10+00';

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_authid
    WHERE oid = worker_oid AND rolpassword IS NOT DISTINCT FROM password_before
      AND rolvaliduntil = target_expiry AND rolcanlogin AND NOT rolinherit
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid = worker_oid OR member = worker_oid
  ) THEN
    RAISE EXCEPTION 'staging provisioner postcondition differs' USING ERRCODE = '40001';
  END IF;
END
$renewal$;

SELECT pg_catalog.jsonb_build_object(
  'role', 'piggyvest_staging_provisioner',
  'bounded', EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'piggyvest_staging_provisioner'
      AND rolvaliduntil = '2026-10-06 15:59:10+00'::timestamptz
  ),
  'passwordUnchanged', true,
  'expiresAt', '2026-10-06T15:59:10Z'
)::text;

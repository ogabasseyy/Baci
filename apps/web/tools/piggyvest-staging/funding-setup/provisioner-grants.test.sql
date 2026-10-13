\set ON_ERROR_STOP on

DO $assert_provisioner$
DECLARE
  target_role oid := 'piggyvest_staging_provisioner'::regrole;
  unsafe_object text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE oid = target_role
      AND rolcanlogin
      AND NOT rolinherit
      AND NOT rolbypassrls
      AND NOT rolsuper
      AND NOT rolcreatedb
      AND NOT rolcreaterole
      AND NOT rolreplication
      AND rolconnlimit = 3
  ) THEN
    RAISE EXCEPTION 'provisioner role attributes are not least-privilege';
  END IF;

  IF NOT has_schema_privilege(target_role, 'piggyvest_staging', 'USAGE') THEN
    RAISE EXCEPTION 'provisioner schema privileges are not bounded';
  END IF;

  SELECT format('%I.%I', namespace.nspname, relation.relname)
  INTO unsafe_object
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND namespace.nspname !~ '^pg_toast'
    AND CASE relation.relkind
      WHEN 'S' THEN has_sequence_privilege(target_role, relation.oid,
        'USAGE,SELECT,UPDATE')
      ELSE has_table_privilege(target_role, relation.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    END
  LIMIT 1;
  IF unsafe_object IS NOT NULL THEN
    RAISE EXCEPTION 'provisioner has direct object privilege on %', unsafe_object;
  END IF;

  IF NOT has_function_privilege(target_role,
      'piggyvest_staging.resolve_wallet_mapping(uuid,text,text)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege(target_role,
      'piggyvest_staging.prepare_provisioning_intent(uuid,uuid,uuid,uuid,text,bytea)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege(target_role,
      'piggyvest_staging.claim_provisioning_intent(uuid,uuid,uuid,integer,text,text)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege(target_role,
      'piggyvest_staging.record_provisioning_result(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege(target_role,
      'piggyvest_staging.expire_provisioning_claim(uuid,uuid,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'provisioner is missing an executor RPC grant';
  END IF;

  IF NOT has_function_privilege(target_role,
      'piggyvest_staging.record_created_customer(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege(target_role,
      'piggyvest_staging.read_provisioning_recovery(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege(target_role,
      'piggyvest_staging.observe_provisioning_recovery(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege(target_role,
      'piggyvest_staging.begin_provisioning_verification(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege(target_role,
      'piggyvest_staging.confirm_provisioning_recovery(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'provisioner is missing a recovery RPC grant';
  END IF;

  IF has_function_privilege(target_role,
      'piggyvest_staging.enqueue_inbox(uuid,text,bytea)'::regprocedure, 'EXECUTE')
    OR has_function_privilege(target_role,
      'piggyvest_staging.claim_inbox(uuid,integer,integer)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'provisioner can execute a non-provisioning RPC';
  END IF;

  SELECT format('%I.%I(%s)', namespace.nspname, procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid))
  INTO unsafe_object
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'piggyvest_staging'
    AND has_function_privilege(target_role, procedure.oid, 'EXECUTE')
    AND procedure.oid NOT IN (
      'piggyvest_staging.resolve_wallet_mapping(uuid,text,text)'::regprocedure,
      'piggyvest_staging.prepare_provisioning_intent(uuid,uuid,uuid,uuid,text,bytea)'::regprocedure,
      'piggyvest_staging.claim_provisioning_intent(uuid,uuid,uuid,integer,text,text)'::regprocedure,
      'piggyvest_staging.record_provisioning_result(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure,
      'piggyvest_staging.expire_provisioning_claim(uuid,uuid,uuid)'::regprocedure,
      'piggyvest_staging.record_created_customer(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure,
      'piggyvest_staging.read_provisioning_recovery(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure,
      'piggyvest_staging.observe_provisioning_recovery(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text)'::regprocedure,
      'piggyvest_staging.begin_provisioning_verification(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure,
      'piggyvest_staging.confirm_provisioning_recovery(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,text)'::regprocedure
    )
  LIMIT 1;
  IF unsafe_object IS NOT NULL THEN
    RAISE EXCEPTION 'provisioner can execute unexpected RPC %', unsafe_object;
  END IF;
END
$assert_provisioner$;

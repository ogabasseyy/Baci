BEGIN;
CREATE FUNCTION prefunded_card.executor_system_identity() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('database',current_database(),'login',session_user,
    'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()))
$$;
REVOKE ALL ON FUNCTION prefunded_card.executor_system_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prefunded_card.executor_system_identity() TO prefunded_treasury_operator, prefunded_authorizer, prefunded_evidence;
COMMIT;

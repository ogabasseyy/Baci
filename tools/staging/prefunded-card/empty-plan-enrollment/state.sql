CREATE FUNCTION pg_temp.enrollment_state() RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE entry record; rows_digest text; predicate text; result jsonb := '{}'::jsonb;
BEGIN
  FOR entry IN SELECT namespace,relation FROM pg_temp.plan_tables() LOOP
    predicate := 'true';
    IF entry.namespace='prefunded_card' AND entry.relation='credit_routes' THEN
      predicate := 'goal_id<>''9f01153c-1589-4dde-b9aa-8f644a846832''::uuid';
    END IF;
    EXECUTE format('SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(source)
      ORDER BY to_jsonb(source)::text),''[]''::jsonb)::text,''UTF8'')),''hex'')
      FROM %I.%I source WHERE %s',entry.namespace,entry.relation,predicate) INTO rows_digest;
    result := result||jsonb_build_object(entry.namespace||'.'||entry.relation,rows_digest);
  END LOOP;
  RETURN result;
END $$;

CREATE FUNCTION pg_temp.enrollment_metadata() RETURNS jsonb
LANGUAGE sql SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('schemaMd5',md5(pg_temp.plan_schema()::text),
    'securitySha256',encode(sha256(convert_to(jsonb_build_object(
      'roles',(SELECT jsonb_agg(to_jsonb(role_row) ORDER BY oid) FROM pg_authid role_row),
      'memberships',(SELECT jsonb_agg(to_jsonb(member_row) ORDER BY roleid,member) FROM pg_auth_members member_row),
      'databases',(SELECT jsonb_agg(to_jsonb(database_row) ORDER BY oid) FROM pg_database database_row))::text,'UTF8')),'hex'),
    'protectedSha256',encode(sha256(convert_to(pg_temp.enrollment_state()::text,'UTF8')),'hex'))
$$;

CREATE FUNCTION pg_temp.enrollment_identity() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres' OR session_user IS DISTINCT FROM 'postgres'
    OR current_user IS DISTINCT FROM 'postgres' OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7685292944002592802'
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz THEN
    RAISE EXCEPTION 'empty enrollment physical identity or deadline refused';
  END IF;
END $$;

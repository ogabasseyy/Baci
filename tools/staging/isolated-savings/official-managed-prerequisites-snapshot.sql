CREATE FUNCTION pg_temp.managed_preserved_state() RETURNS jsonb LANGUAGE plpgsql AS $snapshot$
DECLARE
  item record;
  digest text;
  result jsonb := '{}'::jsonb;
BEGIN
  FOR item IN SELECT nspname, relname FROM pg_class JOIN pg_namespace ON pg_namespace.oid = relnamespace
               WHERE nspname IN ('auth','storage') AND relkind IN ('r','p') ORDER BY nspname, relname LOOP
    EXECUTE format('SELECT md5(COALESCE(string_agg(row_to_json(source)::text,chr(10) ORDER BY row_to_json(source)::text),'''')) FROM %I.%I source', item.nspname, item.relname) INTO digest;
    result := result || jsonb_build_object(item.nspname || '.' || item.relname, digest);
  END LOOP;
  RETURN jsonb_build_object('data', result,
    'relations', (SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(nspname,relname,relowner,relacl,relrowsecurity) ORDER BY nspname,relname)::text,''))
                  FROM pg_class JOIN pg_namespace ON pg_namespace.oid = relnamespace WHERE nspname IN ('auth','storage')),
    'functions', (SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(pg_proc.oid,prosrc,proowner,proacl,proconfig) ORDER BY pg_proc.oid)::text,''))
                  FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pronamespace WHERE nspname IN ('auth','storage')),
    'roles', (SELECT md5(COALESCE(jsonb_agg(to_jsonb(role_row) ORDER BY rolname)::text,'')) FROM pg_roles role_row WHERE rolname <> 'supabase_realtime_admin'),
    'memberships', (SELECT md5(COALESCE(jsonb_agg(to_jsonb(member_row) ORDER BY roleid,member)::text,'')) FROM pg_auth_members member_row));
END
$snapshot$;
CREATE TEMP TABLE managed_preserved_snapshot ON COMMIT DROP AS SELECT pg_temp.managed_preserved_state() AS value;

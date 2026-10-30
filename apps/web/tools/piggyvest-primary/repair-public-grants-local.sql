\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_user <> 'fixture_owner' OR inet_server_addr() IS NOT NULL THEN
  RAISE EXCEPTION 'Local disposable fixture only';
 END IF;
END $$;
DO $$ DECLARE target record; consumer record; actual_acl aclitem[]; actual_owner oid; actual_identity text; privilege text; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_temp.primary_permission_objects)
  OR NOT EXISTS(SELECT 1 FROM pg_temp.primary_permission_consumers) THEN
  RAISE EXCEPTION 'Explicit reviewed object and consumer manifests required';
 END IF;
 FOR consumer IN SELECT * FROM pg_temp.primary_permission_consumers LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=consumer.role_oid AND rolname=consumer.role_name)
   OR EXISTS(SELECT 1 FROM pg_roles restricted
    WHERE restricted.rolname ~ '^(primary_|piggyvest_|baci_primary_|baci_piggyvest_|pvb_)'
     AND (pg_has_role(consumer.role_oid,restricted.oid,'MEMBER')
      OR pg_has_role(restricted.oid,consumer.role_oid,'MEMBER'))) THEN
   RAISE EXCEPTION 'Consumer manifest contains a restricted or changed role';
  END IF;
 END LOOP;
 FOR target IN SELECT * FROM pg_temp.primary_permission_objects ORDER BY object_oid LOOP
  IF target.object_kind='FUNCTION' THEN
   SELECT coalesce(proacl,acldefault('f',proowner)),proowner,oid::regprocedure::text
    INTO actual_acl,actual_owner,actual_identity FROM pg_proc WHERE oid=target.object_oid
     AND prokind=target.expected_prokind AND prokind IN ('f','a','w');
  ELSIF target.object_kind IN ('TABLE','SEQUENCE') THEN
   SELECT coalesce(relacl,acldefault(CASE WHEN relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,relowner)),relowner,oid::regclass::text
    INTO actual_acl,actual_owner,actual_identity FROM pg_class WHERE oid=target.object_oid
     AND CASE WHEN target.object_kind='SEQUENCE' THEN relkind='S' ELSE relkind IN ('r','p','v','m','f') END;
  ELSE
   RAISE EXCEPTION 'Unsupported object kind';
  END IF;
  IF actual_acl IS DISTINCT FROM target.expected_acl OR actual_owner IS DISTINCT FROM target.owner_oid
   OR actual_identity IS DISTINCT FROM target.object_identity THEN
   RAISE EXCEPTION 'Object identity, owner or ACL changed since manifest review';
  END IF;
  FOR privilege IN SELECT privilege_type FROM aclexplode(actual_acl) WHERE grantee=0 LOOP
   IF privilege NOT IN ('EXECUTE','SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','USAGE','MAINTAIN') THEN
    RAISE EXCEPTION 'Unsupported PUBLIC privilege';
   END IF;
   FOR consumer IN SELECT * FROM pg_temp.primary_permission_consumers LOOP
    EXECUTE format('GRANT %s ON %s %s TO %I',privilege,target.object_kind,target.object_identity,consumer.role_name);
   END LOOP;
   EXECUTE format('REVOKE %s ON %s %s FROM PUBLIC',privilege,target.object_kind,target.object_identity);
  END LOOP;
 END LOOP;
END $$;
COMMIT;

export const hostedSavingsResetDropSql = `
CREATE TEMP TABLE recovery_owned(classid oid,objid oid,objsubid integer DEFAULT 0,PRIMARY KEY(classid,objid,objsubid));
INSERT INTO recovery_owned SELECT 'pg_class'::regclass,oid,0 FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'hosted_savings_install_private'::regnamespace,'supabase_migrations'::regnamespace);
INSERT INTO recovery_owned SELECT 'pg_class'::regclass,attrelid,attnum FROM pg_attribute WHERE attnum>0 AND attrelid IN (SELECT objid FROM recovery_owned WHERE classid='pg_class'::regclass);
INSERT INTO recovery_owned SELECT 'pg_proc'::regclass,oid,0 FROM pg_proc WHERE pronamespace='public'::regnamespace;
INSERT INTO recovery_owned SELECT 'pg_type'::regclass,oid,0 FROM pg_type WHERE typnamespace IN ('public'::regnamespace,'hosted_savings_install_private'::regnamespace,'supabase_migrations'::regnamespace);
INSERT INTO recovery_owned SELECT 'pg_constraint'::regclass,oid,0 FROM pg_constraint WHERE connamespace IN ('public'::regnamespace,'hosted_savings_install_private'::regnamespace,'supabase_migrations'::regnamespace);
INSERT INTO recovery_owned SELECT 'pg_attrdef'::regclass,oid,0 FROM pg_attrdef WHERE adrelid IN ('public.orders'::regclass,'hosted_savings_install_private.journal'::regclass,'supabase_migrations.schema_migrations'::regclass);
INSERT INTO recovery_owned VALUES ('pg_namespace'::regclass,'hosted_savings_install_private'::regnamespace,0),('pg_namespace'::regclass,'supabase_migrations'::regnamespace,0);
DO $ownership$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_depend dependency JOIN recovery_owned owned ON owned.classid=dependency.classid AND owned.objid=dependency.objid WHERE dependency.deptype='e')
 THEN RAISE EXCEPTION 'Extension-owned target rejected' USING ERRCODE='P7202'; END IF;
 IF EXISTS(SELECT 1 FROM pg_depend dependency WHERE dependency.refclassid='pg_namespace'::regclass
   AND dependency.refobjid IN ('public'::regnamespace,'hosted_savings_install_private'::regnamespace,'supabase_migrations'::regnamespace)
   AND NOT EXISTS(SELECT 1 FROM recovery_owned owned WHERE owned.classid=dependency.classid AND owned.objid=dependency.objid AND owned.objsubid=dependency.objsubid)
   AND NOT (dependency.classid='pg_default_acl'::regclass AND dependency.refobjid='public'::regnamespace
     AND dependency.objsubid=0 AND dependency.refobjsubid=0
     AND EXISTS(SELECT 1 FROM pg_default_acl retained WHERE retained.oid=dependency.objid AND retained.defaclnamespace='public'::regnamespace
       AND retained.defaclrole IN ('postgres'::regrole,'supabase_admin'::regrole) AND retained.defaclobjtype IN ('S','f','r'))))
 THEN RAISE EXCEPTION 'Unknown direct namespace member' USING ERRCODE='P7204'; END IF;
END $ownership$;
CREATE TEMP TABLE recovery_drop_events(objects integer NOT NULL);
CREATE FUNCTION pg_temp.recovery_drop_guard() RETURNS event_trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
DECLARE dropped record; BEGIN
 FOR dropped IN SELECT * FROM pg_event_trigger_dropped_objects() LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_temp.recovery_owned owned WHERE owned.classid=dropped.classid AND owned.objid=dropped.objid AND owned.objsubid=dropped.objsubid)
     OR (dropped.schema_name IS NOT NULL AND dropped.schema_name NOT IN ('public','hosted_savings_install_private','supabase_migrations'))
     OR (dropped.schema_name IS NULL AND dropped.classid NOT IN ('pg_namespace'::regclass,'pg_attrdef'::regclass,'pg_constraint'::regclass))
   THEN RAISE EXCEPTION 'Drop escaped exact reviewed ownership' USING ERRCODE='P7203'; END IF;
   INSERT INTO pg_temp.recovery_drop_events VALUES(1);
 END LOOP;
END $guard$;
CREATE EVENT TRIGGER hosted_savings_reset_drop_guard ON sql_drop EXECUTE FUNCTION pg_temp.recovery_drop_guard();
ALTER EVENT TRIGGER hosted_savings_reset_drop_guard ENABLE ALWAYS;
DO $drop$ DECLARE item record; BEGIN
 FOR item IN SELECT signature FROM pg_temp.recovery_expected_functions LOOP
   IF to_regprocedure(item.signature) IS NOT NULL THEN EXECUTE 'DROP FUNCTION '||item.signature||' CASCADE'; END IF;
 END LOOP;
END $drop$;
DROP TABLE public.orders CASCADE;
DROP TYPE public.negotiation_status,public.repair_status,public.staff_role CASCADE;
DROP SCHEMA hosted_savings_install_private,supabase_migrations CASCADE;
DO $fired$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_temp.recovery_drop_events) THEN RAISE EXCEPTION 'Drop guard did not run' USING ERRCODE='P7205'; END IF;
END $fired$;
ALTER EVENT TRIGGER hosted_savings_reset_drop_guard DISABLE;
DROP EVENT TRIGGER hosted_savings_reset_drop_guard;
`;

\set ON_ERROR_STOP on
\ir primary-wallet-bank-inbox-setup.integration.sql
CREATE ROLE legacy_permission_consumer NOLOGIN;
CREATE ROLE legacy_noinherit_consumer NOLOGIN NOINHERIT;
CREATE ROLE restricted_permission_descendant NOLOGIN;
GRANT primary_bank_signed_intake TO restricted_permission_descendant;
CREATE SCHEMA net;
CREATE TABLE net.http_request_queue(id bigint);
CREATE SEQUENCE net.http_request_queue_id_seq;
GRANT USAGE ON SCHEMA net TO PUBLIC;
GRANT SELECT,INSERT ON net.http_request_queue TO PUBLIC;
GRANT USAGE,SELECT ON SEQUENCE net.http_request_queue_id_seq TO PUBLIC;
CREATE FUNCTION public.permission_fixture() RETURNS integer LANGUAGE sql AS $$ SELECT 7 $$;
CREATE SCHEMA inaccessible_permission_fixture;
CREATE FUNCTION inaccessible_permission_fixture.helper() RETURNS integer LANGUAGE sql AS $$ SELECT 8 $$;
CREATE FUNCTION inaccessible_permission_fixture.accumulate(integer,integer) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
REVOKE ALL ON FUNCTION inaccessible_permission_fixture.accumulate(integer,integer) FROM PUBLIC;
CREATE AGGREGATE public.permission_aggregate(integer) (SFUNC=inaccessible_permission_fixture.accumulate,STYPE=integer,INITCOND=0);
CREATE FUNCTION public.permission_window() RETURNS bigint LANGUAGE internal WINDOW AS 'window_row_number';
SET SESSION AUTHORIZATION baci_primary_bank_intake;
DO $$ BEGIN
 IF piggyvest_primary.bank_role_safe(false) THEN RAISE EXCEPTION 'PUBLIC contamination not reproduced'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
CREATE TEMP TABLE primary_permission_objects AS
 SELECT oid AS object_oid,'FUNCTION'::text AS object_kind,oid::regprocedure::text AS object_identity,
  proowner AS owner_oid,coalesce(proacl,acldefault('f',proowner)) AS expected_acl,prokind AS expected_prokind
 FROM pg_proc WHERE oid IN ('public.permission_fixture()'::regprocedure,'inaccessible_permission_fixture.helper()'::regprocedure,'public.permission_aggregate(integer)'::regprocedure,'public.permission_window()'::regprocedure)
 UNION ALL
 SELECT oid,CASE WHEN relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END,oid::regclass::text,
  relowner,coalesce(relacl,acldefault(CASE WHEN relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,relowner)),NULL::"char"
 FROM pg_class WHERE oid IN ('net.http_request_queue'::regclass,'net.http_request_queue_id_seq'::regclass);
CREATE TEMP TABLE primary_permission_consumers AS
 SELECT oid AS role_oid,rolname AS role_name FROM pg_roles WHERE rolname IN ('legacy_permission_consumer','legacy_noinherit_consumer','anon','authenticated','service_role');
\if :{?acl_drift}
UPDATE primary_permission_objects SET owner_oid=0 WHERE object_oid='public.permission_fixture()'::regprocedure;
\endif
\if :{?restricted_consumer}
INSERT INTO primary_permission_consumers SELECT oid,rolname FROM pg_roles WHERE rolname='restricted_permission_descendant';
\endif
\if :{?routine_kind_drift}
UPDATE primary_permission_objects SET expected_prokind='f' WHERE object_oid='public.permission_window()'::regprocedure;
\endif
\ir ../../../tools/piggyvest-primary/repair-public-grants-local.sql
SET SESSION AUTHORIZATION baci_primary_bank_intake;
DO $$ BEGIN
 IF NOT piggyvest_primary.bank_role_safe(false) THEN RAISE EXCEPTION 'intake PUBLIC permissions not repaired'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_bank_worker;
DO $$ BEGIN
 IF NOT piggyvest_primary.bank_role_safe(true) THEN RAISE EXCEPTION 'worker PUBLIC permissions not repaired'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ DECLARE consumer text; BEGIN
 FOREACH consumer IN ARRAY ARRAY['legacy_permission_consumer','legacy_noinherit_consumer'] LOOP
  IF NOT has_function_privilege(consumer,'public.permission_fixture()','EXECUTE')
   OR NOT has_function_privilege(consumer,'public.permission_aggregate(integer)','EXECUTE')
   OR NOT has_function_privilege(consumer,'public.permission_window()','EXECUTE')
   OR NOT has_function_privilege(consumer,'inaccessible_permission_fixture.helper()','EXECUTE')
   OR NOT has_table_privilege(consumer,'net.http_request_queue','SELECT')
   OR NOT has_table_privilege(consumer,'net.http_request_queue','INSERT')
   OR NOT has_sequence_privilege(consumer,'net.http_request_queue_id_seq','USAGE')
   OR NOT has_sequence_privilege(consumer,'net.http_request_queue_id_seq','SELECT') THEN
   RAISE EXCEPTION 'existing consumer compatibility lost: %',consumer;
  END IF;
 END LOOP;
 IF has_function_privilege('restricted_permission_descendant','public.permission_fixture()','EXECUTE')
  OR has_table_privilege('restricted_permission_descendant','net.http_request_queue','SELECT') THEN
  RAISE EXCEPTION 'restricted descendant regained ambient grants';
 END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.permission_fixture() TO baci_primary_bank_intake;
SET SESSION AUTHORIZATION baci_primary_bank_intake;
DO $$ BEGIN
 IF piggyvest_primary.bank_role_safe(false) THEN RAISE EXCEPTION 'direct escalation bypassed guard'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
REVOKE EXECUTE ON FUNCTION public.permission_fixture() FROM baci_primary_bank_intake;
GRANT SELECT ON net.http_request_queue TO baci_primary_bank_worker;
SET SESSION AUTHORIZATION baci_primary_bank_worker;
DO $$ BEGIN
 IF piggyvest_primary.bank_role_safe(true) THEN RAISE EXCEPTION 'direct relation escalation bypassed guard'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
REVOKE SELECT ON net.http_request_queue FROM baci_primary_bank_worker;
GRANT USAGE ON SEQUENCE net.http_request_queue_id_seq TO baci_primary_bank_worker;
SET SESSION AUTHORIZATION baci_primary_bank_worker;
DO $$ BEGIN
 IF piggyvest_primary.bank_role_safe(true) THEN RAISE EXCEPTION 'sequence escalation bypassed guard'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
REVOKE USAGE ON SEQUENCE net.http_request_queue_id_seq FROM baci_primary_bank_worker;
GRANT EXECUTE ON FUNCTION inaccessible_permission_fixture.helper() TO baci_primary_bank_intake;
SET SESSION AUTHORIZATION baci_primary_bank_intake;
DO $$ BEGIN
 IF piggyvest_primary.bank_role_safe(false) THEN RAISE EXCEPTION 'inaccessible schema escalation bypassed guard'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
REVOKE EXECUTE ON FUNCTION inaccessible_permission_fixture.helper() FROM baci_primary_bank_intake;
CREATE ROLE future_permission_consumer NOLOGIN;
DO $$ BEGIN
 IF has_function_privilege('future_permission_consumer','public.permission_fixture()','EXECUTE') THEN
  RAISE EXCEPTION 'future role inherited historical PUBLIC grants';
 END IF;
END $$;

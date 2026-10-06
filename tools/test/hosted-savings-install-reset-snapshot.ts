export const hostedSavingsResetSnapshotSql = `
CREATE FUNCTION pg_temp.recovery_protected_object(classid oid,objid oid,objsubid integer) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $object$
DECLARE identified record; BEGIN
 SELECT * INTO identified FROM pg_identify_object(classid,objid,objsubid);
 IF classid='pg_namespace'::regclass THEN
   RETURN identified.identity NOT IN ('hosted_savings_install_private','supabase_migrations') AND identified.identity NOT LIKE 'pg_temp_%' AND identified.identity NOT LIKE 'pg_toast_temp_%';
 END IF;
 RETURN COALESCE(identified.schema NOT IN ('public','hosted_savings_install_private','supabase_migrations','pg_toast') AND identified.schema NOT LIKE 'pg_temp_%' AND identified.schema NOT LIKE 'pg_toast_temp_%',true);
END $object$;
CREATE FUNCTION pg_temp.recovery_snapshot() RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $snapshot$
DECLARE item record; result jsonb='{}'; digest text; query text; BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('pg_namespace','oid NOT IN (SELECT oid FROM pg_namespace WHERE nspname IN (''hosted_savings_install_private'',''supabase_migrations'') OR nspname LIKE ''pg_temp_%'' OR nspname LIKE ''pg_toast_temp_%'')'),
 ('pg_class','relnamespace IN (SELECT oid FROM pg_namespace WHERE nspname NOT IN (''public'',''hosted_savings_install_private'',''supabase_migrations'',''pg_toast'') AND nspname NOT LIKE ''pg_temp_%'' AND nspname NOT LIKE ''pg_toast_temp_%'')'),
 ('pg_proc','pronamespace IN (SELECT oid FROM pg_namespace WHERE nspname NOT IN (''public'',''hosted_savings_install_private'',''supabase_migrations'') AND nspname NOT LIKE ''pg_temp_%'')'),
 ('pg_type','typnamespace IN (SELECT oid FROM pg_namespace WHERE nspname NOT IN (''public'',''hosted_savings_install_private'',''supabase_migrations'',''pg_toast'') AND nspname NOT LIKE ''pg_temp_%'' AND nspname NOT LIKE ''pg_toast_temp_%'')'),
 ('pg_attribute','attrelid IN (SELECT oid FROM pg_class WHERE relnamespace IN (SELECT oid FROM pg_namespace WHERE nspname NOT IN (''public'',''hosted_savings_install_private'',''supabase_migrations'',''pg_toast'') AND nspname NOT LIKE ''pg_temp_%'' AND nspname NOT LIKE ''pg_toast_temp_%''))'),
 ('pg_attrdef','adrelid IN (SELECT oid FROM pg_class WHERE relnamespace IN (SELECT oid FROM pg_namespace WHERE nspname NOT IN (''public'',''hosted_savings_install_private'',''supabase_migrations'',''pg_toast'') AND nspname NOT LIKE ''pg_temp_%'' AND nspname NOT LIKE ''pg_toast_temp_%''))'),
 ('pg_constraint','connamespace IN (SELECT oid FROM pg_namespace WHERE nspname NOT IN (''public'',''hosted_savings_install_private'',''supabase_migrations'') AND nspname NOT LIKE ''pg_temp_%'')'),
 ('pg_trigger','tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace IN (SELECT oid FROM pg_namespace WHERE nspname NOT IN (''public'',''hosted_savings_install_private'',''supabase_migrations'') AND nspname NOT LIKE ''pg_temp_%''))'),
 ('pg_rewrite','ev_class IN (SELECT oid FROM pg_class WHERE relnamespace IN (SELECT oid FROM pg_namespace WHERE nspname NOT IN (''public'',''hosted_savings_install_private'',''supabase_migrations'') AND nspname NOT LIKE ''pg_temp_%''))'),
 ('pg_policy','polrelid IN (SELECT oid FROM pg_class WHERE relnamespace IN (SELECT oid FROM pg_namespace WHERE nspname NOT IN (''public'',''hosted_savings_install_private'',''supabase_migrations'') AND nspname NOT LIKE ''pg_temp_%''))'),
 ('pg_index','indrelid IN (SELECT oid FROM pg_class WHERE relnamespace IN (SELECT oid FROM pg_namespace WHERE nspname NOT IN (''public'',''hosted_savings_install_private'',''supabase_migrations'',''pg_toast'') AND nspname NOT LIKE ''pg_temp_%'' AND nspname NOT LIKE ''pg_toast_temp_%''))'),
 ('pg_enum','enumtypid IN (SELECT oid FROM pg_type WHERE typnamespace NOT IN (SELECT oid FROM pg_namespace WHERE nspname=''public'' OR nspname LIKE ''pg_temp_%''))'),
 ('pg_range','rngtypid IN (SELECT oid FROM pg_type WHERE typnamespace NOT IN (SELECT oid FROM pg_namespace WHERE nspname=''public'' OR nspname LIKE ''pg_temp_%''))'),
 ('pg_authid','true'),('pg_auth_members','true'),('pg_db_role_setting','true'),('pg_default_acl','true'),
 ('pg_database','true'),('pg_extension','true'),('pg_event_trigger','true'),('pg_publication','true'),
 ('pg_publication_rel','true'),('pg_publication_namespace','true'),('pg_subscription','true'),
 ('pg_foreign_server','true'),('pg_foreign_data_wrapper','true'),('pg_user_mapping','true'),
 ('pg_collation','true'),('pg_conversion','true'),('pg_operator','true'),('pg_opclass','true'),('pg_opfamily','true'),
 ('pg_am','true'),('pg_amop','true'),('pg_amproc','true'),('pg_cast','true'),('pg_language','true'),
 ('pg_ts_config','true'),('pg_ts_config_map','true'),('pg_ts_dict','true'),('pg_ts_parser','true'),('pg_ts_template','true'),
 ('pg_transform','true'),('pg_largeobject','true'),('pg_largeobject_metadata','true'),('pg_shdescription','true'),
 ('pg_parameter_acl','true'),('pg_replication_origin','true'),('pg_foreign_table','true'),('pg_partitioned_table','true'),
 ('pg_description','pg_temp.recovery_protected_object(classoid,objoid,objsubid)'),
 ('pg_seclabel','pg_temp.recovery_protected_object(classoid,objoid,objsubid)'),('pg_shseclabel','true'),
 ('pg_depend','pg_temp.recovery_protected_object(classid,objid,objsubid)'),
 ('pg_shdepend','(dbid=0 OR dbid=(SELECT oid FROM pg_database WHERE datname=current_database())) AND pg_temp.recovery_protected_object(classid,objid,objsubid)'),
 ('pg_sequence','pg_temp.recovery_protected_object(''pg_class''::regclass,seqrelid,0)'),
 ('pg_inherits','pg_temp.recovery_protected_object(''pg_class''::regclass,inhrelid,0)'),
 ('pg_statistic_ext','pg_temp.recovery_protected_object(''pg_statistic_ext''::regclass,oid,0)'),
 ('pg_statistic_ext_data','pg_temp.recovery_protected_object(''pg_statistic_ext''::regclass,stxoid,0)')
 ) AS checks(catalog,predicate) LOOP
   query:=format('SELECT encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(row)::text,chr(10) ORDER BY to_jsonb(row)::text),''''),''UTF8'')),''hex'') FROM pg_catalog.%I row WHERE %s',item.catalog,item.predicate);
   EXECUTE query INTO digest;
   result:=result||jsonb_build_object(item.catalog,digest);
 END LOOP;
 FOR item IN SELECT relation.oid, namespace.nspname,relation.relname,relation.relkind
   FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
   WHERE namespace.nspname NOT IN ('public','hosted_savings_install_private','supabase_migrations','pg_catalog','information_schema','pg_toast')
   AND namespace.nspname NOT LIKE 'pg_temp_%' AND namespace.nspname NOT LIKE 'pg_toast_temp_%'
   AND relation.relkind IN ('r','p','m','S','f') ORDER BY relation.oid LOOP
   IF item.relkind='f' THEN RAISE EXCEPTION 'Foreign data cannot be snapshotted safely' USING ERRCODE='P7201'; END IF;
   IF item.relkind='S' THEN
     EXECUTE format('SELECT encode(sha256(convert_to(jsonb_build_array(last_value,log_cnt,is_called)::text,''UTF8'')),''hex'') FROM %I.%I',item.nspname,item.relname) INTO digest;
   ELSE
     EXECUTE format('SELECT encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(row)::text,chr(10) ORDER BY to_jsonb(row)::text),''''),''UTF8'')),''hex'') FROM ONLY %I.%I row',item.nspname,item.relname) INTO digest;
   END IF;
   result:=result||jsonb_build_object('data:'||item.oid::text,digest);
 END LOOP;
 RETURN result;
END $snapshot$;
`;

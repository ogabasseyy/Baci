export const hostedSavingsResetChecksSql = `
DO $closure$ DECLARE item record; actual oid; BEGIN
 IF current_setting('pg_stat_statements.track',true) IS DISTINCT FROM 'none'
 THEN RAISE EXCEPTION 'Query tracking is not disabled' USING ERRCODE='P7210'; END IF;
 IF to_regclass('public.admin_query_performance') IS NOT NULL
   OR to_regclass('public.orders') IS NULL OR to_regclass('hosted_savings_install_private.journal') IS NULL
   OR to_regclass('supabase_migrations.schema_migrations') IS NULL
 THEN RAISE EXCEPTION 'Wrong first-file boundary' USING ERRCODE='P7212'; END IF;
 IF EXISTS(SELECT 1 FROM public.orders) OR EXISTS(SELECT 1 FROM hosted_savings_install_private.journal)
   OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations) OR EXISTS(SELECT 1 FROM auth.users)
 THEN RAISE EXCEPTION 'Data or successful replay accounting exists' USING ERRCODE='P7213'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace)<>178
 THEN RAISE EXCEPTION 'Unexpected public function count' USING ERRCODE='P7214'; END IF;
 FOR item IN SELECT signature,body_md5 FROM pg_temp.recovery_expected_functions LOOP
   actual:=to_regprocedure(item.signature);
   IF actual IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=actual AND proowner='postgres'::regrole AND prokind='f' AND md5(prosrc)=item.body_md5)
   THEN RAISE EXCEPTION 'Function differs from exact baseline prefix' USING ERRCODE='P7215'; END IF;
 END LOOP;
 IF (SELECT array_agg(relname::text ORDER BY relname) FROM pg_class WHERE relnamespace='public'::regnamespace) IS DISTINCT FROM ARRAY['orders']::text[]
   OR (SELECT array_agg(relname::text ORDER BY relname) FROM pg_class WHERE relnamespace='hosted_savings_install_private'::regnamespace) IS DISTINCT FROM ARRAY['journal','journal_pkey']::text[]
   OR (SELECT array_agg(relname::text ORDER BY relname) FROM pg_class WHERE relnamespace='supabase_migrations'::regnamespace) IS DISTINCT FROM ARRAY['schema_migrations','schema_migrations_pkey']::text[]
 THEN RAISE EXCEPTION 'Unknown relation in owned closure' USING ERRCODE='P7216'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'hosted_savings_install_private'::regnamespace,'supabase_migrations'::regnamespace)
   AND (relowner<>'postgres'::regrole OR relkind NOT IN ('r','i') OR relpersistence<>'p'))
 THEN RAISE EXCEPTION 'Wrong owned relation identity' USING ERRCODE='P7217'; END IF;
 IF (SELECT array_agg(typname::text ORDER BY typname) FROM pg_type WHERE typnamespace='public'::regnamespace)
   IS DISTINCT FROM ARRAY['_negotiation_status','_orders','_repair_status','_staff_role','negotiation_status','orders','repair_status','staff_role']::text[]
 THEN RAISE EXCEPTION 'Unknown public type' USING ERRCODE='P7218'; END IF;
 IF (SELECT array_agg(typname::text ORDER BY typname) FROM pg_type WHERE typnamespace='hosted_savings_install_private'::regnamespace) IS DISTINCT FROM ARRAY['_journal','journal']::text[]
 OR (SELECT array_agg(typname::text ORDER BY typname) FROM pg_type WHERE typnamespace='supabase_migrations'::regnamespace) IS DISTINCT FROM ARRAY['_schema_migrations','schema_migrations']::text[]
 OR (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint WHERE connamespace='public'::regnamespace) IS DISTINCT FROM ARRAY['orders_fulfillment_type_check']::text[]
 OR (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint WHERE connamespace='hosted_savings_install_private'::regnamespace) IS DISTINCT FROM ARRAY['journal_pkey']::text[]
 OR (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint WHERE connamespace='supabase_migrations'::regnamespace) IS DISTINCT FROM ARRAY['schema_migrations_pkey']::text[]
 THEN RAISE EXCEPTION 'Unexpected ledger type or constraint' USING ERRCODE='P7224'; END IF;
 IF (SELECT array_agg(enumlabel::text ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid='public.negotiation_status'::regtype)
   IS DISTINCT FROM ARRAY['pending','accepted','rejected','countered']::text[]
 OR (SELECT array_agg(enumlabel::text ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid='public.repair_status'::regtype)
   IS DISTINCT FROM ARRAY['pending','confirmed','in_progress','completed','cancelled','rejected']::text[]
 OR (SELECT array_agg(enumlabel::text ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid='public.staff_role'::regtype)
   IS DISTINCT FROM ARRAY['admin','manager','sales_rep','inventory','accountant','customer_service','marketing','fulfillment','blog_manager']::text[]
 THEN RAISE EXCEPTION 'Enum differs from reviewed baseline' USING ERRCODE='P7219'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace IN ('hosted_savings_install_private'::regnamespace,'supabase_migrations'::regnamespace))
 OR EXISTS(SELECT 1 FROM pg_default_acl WHERE defaclnamespace IN ('hosted_savings_install_private'::regnamespace,'supabase_migrations'::regnamespace))
 OR (SELECT count(*) FROM pg_default_acl WHERE defaclnamespace='public'::regnamespace)<>6
 THEN RAISE EXCEPTION 'Unknown routine or default ACL boundary' USING ERRCODE='P7220'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid IN ('public.orders'::regclass,'hosted_savings_install_private.journal'::regclass,'supabase_migrations.schema_migrations'::regclass))
 OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid IN ('public.orders'::regclass,'hosted_savings_install_private.journal'::regclass,'supabase_migrations.schema_migrations'::regclass))
 OR EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class IN ('public.orders'::regclass,'hosted_savings_install_private.journal'::regclass,'supabase_migrations.schema_migrations'::regclass))
 THEN RAISE EXCEPTION 'Unexpected attached object' USING ERRCODE='P7221'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='public' AND nspowner='pg_database_owner'::regrole
   AND nspacl::text='{pg_database_owner=UC/pg_database_owner,=U/pg_database_owner,postgres=U/pg_database_owner,anon=U/pg_database_owner,authenticated=U/pg_database_owner,service_role=U/pg_database_owner}')
 THEN RAISE EXCEPTION 'Public owner or exact ACL differs from reviewed current state' USING ERRCODE='P7222'; END IF;
END $closure$;
CREATE FUNCTION pg_temp.recovery_table_shape(target oid) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $shape$
 SELECT jsonb_build_object('columns',(SELECT jsonb_agg((to_jsonb(attribute)-'attrelid') ORDER BY attnum) FROM pg_attribute attribute WHERE attrelid=target AND attnum>0),
   'defaults',(SELECT jsonb_agg(jsonb_build_array(adnum,pg_get_expr(adbin,adrelid)) ORDER BY adnum) FROM pg_attrdef WHERE adrelid=target),
   'constraints',(SELECT jsonb_agg(jsonb_build_array(contype,conname,pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=target),
   'options',(SELECT reloptions FROM pg_class WHERE oid=target));
$shape$;
DO $orders$ BEGIN
 IF pg_temp.recovery_table_shape('public.orders'::regclass) IS DISTINCT FROM pg_temp.recovery_table_shape('pg_temp.recovery_expected_orders'::regclass)
 THEN RAISE EXCEPTION 'Orders differs from reviewed baseline' USING ERRCODE='P7223'; END IF;
END $orders$;
DO $locks$ DECLARE item record; BEGIN
 FOR item IN SELECT namespace.nspname,relation.relname FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
   WHERE namespace.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND namespace.nspname NOT LIKE 'pg_temp_%' AND namespace.nspname NOT LIKE 'pg_toast_temp_%'
   AND relation.relkind IN ('r','p') ORDER BY relation.oid LOOP
   EXECUTE format('LOCK TABLE ONLY %I.%I IN SHARE MODE',item.nspname,item.relname);
 END LOOP;
END $locks$;
`;

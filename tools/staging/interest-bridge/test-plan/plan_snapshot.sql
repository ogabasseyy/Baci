CREATE TEMP TABLE test_plan_session(payload jsonb) ON COMMIT DROP;

CREATE FUNCTION pg_temp.plan_tables() RETURNS TABLE(namespace text, relation text)
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT namespace.nspname::text,relation.relname::text
  FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
  WHERE relation.relkind IN ('r','p') AND (
    (namespace.nspname NOT LIKE 'pg_%' AND namespace.nspname NOT IN
      ('information_schema','auth','extensions','vault','realtime','storage'))
    OR (namespace.nspname='auth' AND relation.relname='users'))
  ORDER BY namespace.nspname,relation.relname
$$;

CREATE FUNCTION pg_temp.plan_schema() RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  WITH objects AS (
    SELECT jsonb_build_object('kind','table','name',namespace||'.'||relation,
      'rls',source.relrowsecurity,'forceRls',source.relforcerowsecurity,
      'owner',source.relowner,'acl',source.relacl) AS item
    FROM pg_temp.plan_tables() tables
    JOIN pg_namespace space ON space.nspname=tables.namespace
    JOIN pg_class source ON source.relnamespace=space.oid AND source.relname=tables.relation
    UNION ALL
    SELECT jsonb_build_object('kind','column','table',source.attrelid::regclass::text,
      'name',source.attname,'type',format_type(source.atttypid,source.atttypmod),
      'notNull',source.attnotnull,'identity',source.attidentity,'generated',source.attgenerated,'acl',source.attacl,
      'default',pg_get_expr(defaults.adbin,defaults.adrelid))
    FROM pg_attribute source JOIN pg_class relation ON relation.oid=source.attrelid
    JOIN pg_namespace space ON space.oid=relation.relnamespace
    JOIN pg_temp.plan_tables() tables ON tables.namespace=space.nspname AND tables.relation=relation.relname
    LEFT JOIN pg_attrdef defaults ON defaults.adrelid=source.attrelid AND defaults.adnum=source.attnum
    WHERE source.attnum>0 AND NOT source.attisdropped
    UNION ALL
    SELECT jsonb_build_object('kind','index','table',source.indrelid::regclass::text,
      'definition',pg_get_indexdef(source.indexrelid),'valid',source.indisvalid,
      'ready',source.indisready,'unique',source.indisunique)
    FROM pg_index source JOIN pg_class relation ON relation.oid=source.indrelid
    JOIN pg_namespace space ON space.oid=relation.relnamespace
    JOIN pg_temp.plan_tables() tables ON tables.namespace=space.nspname AND tables.relation=relation.relname
    UNION ALL
    SELECT jsonb_build_object('kind','constraint','table',source.conrelid::regclass::text,
      'name',source.conname,'validated',source.convalidated,'definition',pg_get_constraintdef(source.oid))
    FROM pg_constraint source JOIN pg_class relation ON relation.oid=source.conrelid
    JOIN pg_namespace space ON space.oid=relation.relnamespace
    JOIN pg_temp.plan_tables() tables ON tables.namespace=space.nspname AND tables.relation=relation.relname
    UNION ALL
    SELECT jsonb_build_object('kind','trigger','table',source.tgrelid::regclass::text,
      'name',source.tgname,'enabled',source.tgenabled,'definition',pg_get_triggerdef(source.oid))
    FROM pg_trigger source JOIN pg_class relation ON relation.oid=source.tgrelid
    JOIN pg_namespace space ON space.oid=relation.relnamespace
    JOIN pg_temp.plan_tables() tables ON tables.namespace=space.nspname AND tables.relation=relation.relname
    WHERE NOT source.tgisinternal
    UNION ALL
    SELECT jsonb_build_object('kind','policy','table',schemaname||'.'||tablename,
      'name',policyname,'roles',roles,'permissive',permissive,'command',cmd,'using',qual,'check',with_check)
    FROM pg_policies source JOIN pg_temp.plan_tables() tables
      ON tables.namespace=source.schemaname AND tables.relation=source.tablename
    UNION ALL
    SELECT jsonb_build_object('kind','function','signature',source.oid::regprocedure::text,
      'definitionMd5',md5(pg_get_functiondef(source.oid)),'owner',source.proowner,
      'acl',source.proacl,'configuration',source.proconfig,'securityDefiner',source.prosecdef)
    FROM pg_proc source JOIN pg_namespace namespace ON namespace.oid=source.pronamespace
    WHERE source.prokind='f' AND namespace.nspname NOT LIKE 'pg_%'
      AND namespace.nspname NOT IN ('information_schema','extensions','vault','realtime','storage')
    UNION ALL
    SELECT jsonb_build_object('kind','role','name',rolname,'login',rolcanlogin,
      'inherit',rolinherit,'superuser',rolsuper,'bypassRls',rolbypassrls,'createDb',rolcreatedb,
      'createRole',rolcreaterole,'replication',rolreplication,'validUntil',rolvaliduntil)
    FROM pg_roles WHERE rolname IN ('authenticated','prefunded_treasury_operator')
    UNION ALL
    SELECT jsonb_build_object('kind','membership','role',roleid,'member',member,
      'grantor',grantor,'admin',admin_option,'inherit',inherit_option,'set',set_option)
    FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles
      WHERE rolname IN ('authenticated','prefunded_treasury_operator'))
    UNION ALL
    SELECT jsonb_build_object('kind','schema','name',nspname,'owner',nspowner,'acl',nspacl)
    FROM pg_namespace WHERE nspname NOT LIKE 'pg_%'
      AND nspname NOT IN ('information_schema','extensions','vault','realtime','storage')
  ) SELECT coalesce(jsonb_agg(item ORDER BY item::text),'[]'::jsonb) FROM objects
$$;

CREATE FUNCTION pg_temp.plan_state() RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE saved_goal uuid; entry record; rows_digest text; predicate text;
  result jsonb := '{}'::jsonb;
BEGIN
  SELECT id INTO saved_goal FROM public.customer_savings_goals
    WHERE metadata->>'stagingTestPlanKey'='pvb-empty-interest-staging-20261002-v1';
  FOR entry IN SELECT namespace,relation FROM pg_temp.plan_tables() LOOP
    predicate := 'true';
    IF saved_goal IS NOT NULL THEN
      IF entry.namespace='public' AND entry.relation='customer_savings_goals' THEN
        predicate := format('id<>%L::uuid',saved_goal);
      ELSIF entry.namespace='public' AND entry.relation='customer_savings_events' THEN
        predicate := format('NOT (goal_id=%L::uuid AND event_type=''goal_created'')',saved_goal);
      ELSIF entry.namespace='public' AND entry.relation='customer_savings_goal_idempotency_keys' THEN
        predicate := format('NOT (goal_id=%L::uuid AND idempotency_key=''pvb-empty-interest-staging-20261002-v1'')',saved_goal);
      ELSIF (entry.namespace='piggyvest_staging' AND entry.relation='wallet_goal_mappings')
        OR (entry.namespace='piggyvest_savings_ledger' AND entry.relation IN ('bindings','interest_policies')) THEN
        predicate := format('goal_id<>%L::uuid',saved_goal);
      END IF;
    END IF;
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(source) ORDER BY to_jsonb(source)::text),''[]''::jsonb)::text)
      FROM %I.%I source WHERE %s',entry.namespace,entry.relation,predicate) INTO rows_digest;
    result := result||jsonb_build_object(entry.namespace||'.'||entry.relation,rows_digest);
  END LOOP;
  RETURN result;
END $$;

CREATE FUNCTION pg_temp.plan_inventory() RETURNS jsonb
LANGUAGE sql SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
    'observedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'schemaMd5',md5(pg_temp.plan_schema()::text),'stateMd5',md5(pg_temp.plan_state()::text),
    'schema',pg_temp.plan_schema(),'state',pg_temp.plan_state(),
    'companyBudgetKobo',(SELECT opening_available_kobo::numeric
      +coalesce((SELECT sum(amount_kobo) FROM prefunded_card.treasury_replenishments
        WHERE treasury_binding_id=identity.treasury_binding_id),0)
      FROM prefunded_card.treasury_identities identity
      WHERE treasury_binding_id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'),
    'aggregateTreasuryBudgetKobo',(SELECT sum(opening_available_kobo) FROM prefunded_card.treasury_identities)
      +coalesce((SELECT sum(amount_kobo) FROM prefunded_card.treasury_replenishments),0),
    'oldGoal', (SELECT jsonb_build_object('productId',product_id,'variantId',variant_id,
      'principalKobo',current_amount*100,'goalKind',goal_kind,'status',status)
      FROM public.customer_savings_goals WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'),
    'merchant', (SELECT jsonb_build_object('published',is_published) FROM public.merchants
      WHERE id='10000000-0000-4000-8000-000000000001'),
    'savingsEnabled', (SELECT customer_device_savings_enabled FROM public.merchant_feature_settings
      WHERE merchant_id='10000000-0000-4000-8000-000000000001'))
$$;

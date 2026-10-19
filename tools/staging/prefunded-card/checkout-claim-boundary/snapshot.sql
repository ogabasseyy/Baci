WITH namespaces AS MATERIALIZED (
  SELECT oid FROM pg_namespace WHERE nspname<>'information_schema' AND nspname !~ '^pg_'
), relations AS MATERIALIZED (
  SELECT relation.* FROM pg_class relation WHERE relnamespace IN (SELECT oid FROM namespaces)
    AND relpersistence<>'t'
), targets AS MATERIALIZED (
  SELECT signature,to_regprocedure(signature)::oid oid FROM (VALUES
    ('prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid)'),
    ('prefunded_card.claim_reconciliation(uuid,integer)')) named(signature)
), rows AS MATERIALIZED (
  SELECT relation.oid,relation.relkind,relation.relispopulated,relation.relowner,
    pg_get_userbyid(relation.relowner) owner_name,format('%I.%I',namespace.nspname,relation.relname) name,
    CASE WHEN relation.relkind='m' AND NOT relation.relispopulated THEN
      query_to_xml('SELECT 0::bigint AS row_count, encode(sha256(convert_to(
        jsonb_build_object(''materializedState'',''unpopulated'',''rows'',''[]''::jsonb)::text,
        ''UTF8'')),''hex'') AS row_sha256',false,false,'')
    ELSE query_to_xml(format('SELECT count(*) AS row_count, encode(sha256(convert_to(coalesce(
      jsonb_agg(to_jsonb(source) ORDER BY to_jsonb(source)::text COLLATE "C"),''[]''::jsonb)::text,
      ''UTF8'')),''hex'') AS row_sha256 FROM %s source',CASE WHEN relation.relkind='S' THEN
        format('(SELECT last_value,log_cnt,is_called FROM %I.%I)',namespace.nspname,relation.relname)
        ELSE format('%I.%I',namespace.nspname,relation.relname) END),
      false,false,'') END payload
  FROM relations relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
  WHERE relation.relkind IN ('r','p','S','m')
), metadata AS (
  SELECT jsonb_build_object(
    'namespaces',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_namespace entry WHERE oid IN (SELECT oid FROM namespaces)),
    'relations',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM relations entry),
    'routines',(SELECT jsonb_agg(CASE WHEN oid IN (SELECT oid FROM targets) THEN to_jsonb(entry)-'prosrc'
      ELSE to_jsonb(entry) END ORDER BY oid) FROM pg_proc entry WHERE pronamespace IN (SELECT oid FROM namespaces)),
    'languages',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_language entry),
    'triggers',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_trigger entry WHERE tgrelid IN (SELECT oid FROM relations)),
    'policies',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_policy entry WHERE polrelid IN (SELECT oid FROM relations)),
    'constraints',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_constraint entry WHERE connamespace IN (SELECT oid FROM namespaces)),
    'attributes',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY attrelid,attnum) FROM pg_attribute entry WHERE attrelid IN (SELECT oid FROM relations)),
    'defaults',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_attrdef entry WHERE adrelid IN (SELECT oid FROM relations)),
    'indexes',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY indexrelid) FROM pg_index entry WHERE indrelid IN (SELECT oid FROM relations)),
    'rules',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_rewrite entry WHERE ev_class IN (SELECT oid FROM relations)),
    'types',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_type entry WHERE typnamespace IN (SELECT oid FROM namespaces)),
    'enumValues',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_enum entry WHERE enumtypid IN
      (SELECT oid FROM pg_type WHERE typnamespace IN (SELECT oid FROM namespaces))),
    'sequences',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY seqrelid) FROM pg_sequence entry WHERE seqrelid IN (SELECT oid FROM relations)),
    'roles',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_authid entry),
    'memberships',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY roleid,member) FROM pg_auth_members entry),
    'defaultAcls',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_default_acl entry),
    'databases',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_database entry),
    'extensions',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_extension entry),
    'eventTriggers',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_event_trigger entry)
  ) payload
)
SELECT jsonb_build_object(
  'version',1,'capturedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'sourceClosureSha256','__CLOSURE__',
  'identity',jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
    'database',current_database(),'databaseOid',(SELECT oid::bigint FROM pg_database WHERE datname=current_database()),
    'sessionUser',session_user,'currentUser',current_user,'roleOid',(SELECT oid::bigint FROM pg_roles WHERE rolname=current_user),
    'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),'localSocket',inet_client_addr() IS NULL,
    'sessionReplicationRole',current_setting('session_replication_role')),
  'functions',(SELECT jsonb_object_agg(target.signature,jsonb_build_object('oid',routine.oid::bigint,
    'ownerOid',routine.proowner::bigint,'owner',pg_get_userbyid(routine.proowner),'acl',routine.proacl,
    'configuration',routine.proconfig,'language',language.lanname,'securityDefiner',routine.prosecdef,
    'body',routine.prosrc,'bodySha256',encode(sha256(convert_to(routine.prosrc,'UTF8')),'hex'),
    'catalogSha256',encode(sha256(convert_to((to_jsonb(routine)-'prosrc')::text,'UTF8')),'hex')))
    FROM targets target JOIN pg_proc routine ON routine.oid=target.oid
    JOIN pg_language language ON language.oid=routine.prolang),
  'tableRows',(SELECT jsonb_object_agg(name,jsonb_build_object('oid',oid::bigint,
    'count',(xpath('/table/row/row_count/text()',payload))[1]::text::bigint,
    'sha256',(xpath('/table/row/row_sha256/text()',payload))[1]::text)
    || CASE WHEN relkind='m' THEN jsonb_build_object('kind','m','populated',relispopulated,
      'ownerOid',relowner::bigint,'owner',owner_name) ELSE '{}'::jsonb END) FROM rows),
  'unsupportedRelations',coalesce((SELECT jsonb_agg(format('%I.%I',namespace.nspname,relation.relname) ORDER BY relation.oid)
    FROM relations relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE relation.relkind='f'),'[]'::jsonb),
  'permanentMetadataSha256',(SELECT encode(sha256(convert_to(payload::text,'UTF8')),'hex') FROM metadata)
) evidence;

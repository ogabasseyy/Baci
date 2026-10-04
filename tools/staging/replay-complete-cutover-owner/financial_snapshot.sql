BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL timezone='UTC';
SET LOCAL datestyle='ISO, YMD';
SET LOCAL intervalstyle='postgres';
SET LOCAL extra_float_digits=3;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
DO $financial_identity$ BEGIN
  IF session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
    OR current_database() IS DISTINCT FROM 'postgres'
    OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
    OR (SELECT usename FROM pg_stat_activity WHERE pid=pg_backend_pid()) IS DISTINCT FROM 'postgres'
    OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7685292944002592802'
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz
    OR current_setting('transaction_isolation') IS DISTINCT FROM 'repeatable read'
    OR current_setting('transaction_read_only') IS DISTINCT FROM 'on'
    OR current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
    RAISE EXCEPTION 'financial_snapshot_identity_refused' USING ERRCODE='42501';
  END IF;
  IF to_regprocedure('prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid)') IS NULL
    OR to_regprocedure('prefunded_card.claim_reconciliation(uuid,integer)') IS NULL
    OR EXISTS (SELECT 1 FROM unnest(ARRAY[
      'prefunded_card.operations','prefunded_card.checkout_intents','prefunded_card.dispatch_queue',
      'prefunded_card.projections','prefunded_card.provider_aliases','piggyvest_savings_ledger.operations',
      'piggyvest_savings_ledger.postings','public.customer_savings_contributions','public.customer_savings_goals',
      'savings_notifications.events','savings_notifications.deliveries','prefunded_card.treasury_bindings'
    ]) required(name) LEFT JOIN pg_class relation ON relation.oid=to_regclass(required.name)
    WHERE relation.oid IS NULL OR relation.relkind NOT IN ('r','p') OR relation.relpersistence<>'p') THEN
    RAISE EXCEPTION 'financial_snapshot_scope_refused' USING ERRCODE='42501';
  END IF;
END $financial_identity$;
WITH full_snapshot AS MATERIALIZED (
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
) evidence
), scope AS MATERIALIZED (
  SELECT 'ff561046-58e7-428d-9163-f6e60b0dab65'::uuid operation_id,
    '9f01153c-1589-4dde-b9aa-8f644a846832'::uuid new_goal_id,
    '430314fd-cd8b-4579-98d4-e9f345713dd6'::uuid old_goal_id,
    'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'::uuid treasury_id,
    'pvb-card:ff561046-58e7-428d-9163-f6e60b0dab65'::text idempotency_key
), allowed_targets(namespace,relation,predicate,visible_columns) AS MATERIALIZED (VALUES
  ('prefunded_card','operations','source.id=%1$L::uuid',ARRAY[
    'id','integration_id','merchant_id','customer_id','goal_id','treasury_binding_id','request_fingerprint',
    'idempotency_key','saved_method_id','amount_kobo','fee_allowance_kobo','currency','collection_reference',
    'transfer_reference','destination_wallet_id','destination_customer_id','collection_status','transfer_status',
    'projection_status','collection_fence','transfer_fence','verification_fence','verification_lease_expires_at',
    'collection_attempted_at','transfer_attempted_at','collection_provider_transaction_id',
    'transfer_provider_transaction_id','checkout_retired','created_at']),
  ('prefunded_card','checkout_intents','source.operation_id=%1$L::uuid',ARRAY[
    'id','operation_id','deployment','integration_id','merchant_id','customer_id','actor_id','goal_id',
    'treasury_binding_id','business_id','system_identifier','expires_at','database_name','authorized_login',
    'amount_kobo','currency','idempotency_key','idempotency_hash','request_fingerprint','reference','transfer_reference',
    'prepared_saved_method_id','consent_version','consent_one_time_charge','consent_save_card','phase',
    'initialization_fence','initialization_lease_expires_at','session_reference','reconciliation_flagged_at',
    'reconciliation_flagged_by','created_at']),
  ('prefunded_card','dispatch_queue','source.operation_id=%1$L::uuid',ARRAY[
    'operation_id','available_at','lease_expires_at','finished_at','attempts']),
  ('prefunded_card','projections','source.operation_id=%1$L::uuid',ARRAY[
    'operation_id','contribution_id','ledger_operation_id','amount_kobo','created_xid','created_at']),
  ('prefunded_card','provider_aliases','source.operation_id=%1$L::uuid',ARRAY[
    'integration_id','provider_transaction_id','operation_id','created_at']),
  ('piggyvest_savings_ledger','operations','source.id=%1$L::uuid',ARRAY[
    'id','integration_id','merchant_id','customer_id','goal_id','evidence_id','reference_id','created_at','created_xid']),
  ('piggyvest_savings_ledger','postings','source.operation_id=%1$L::uuid',ARRAY['operation_id','account','amount_kobo']),
  ('public','customer_savings_contributions','source.goal_id=%2$L::uuid AND source.idempotency_key=%3$L',ARRAY[
    'id','goal_id','merchant_id','customer_id','wallet_transaction_id','transaction_id','saved_payment_method_id',
    'amount','source_type','status','scheduled_for','processed_at','failed_at','idempotency_key','created_at','updated_at']),
  ('public','customer_savings_goals','source.id=%2$L::uuid',ARRAY[
    'id','merchant_id','customer_id','product_id','variant_id','target_amount','current_amount',
    'initial_contribution_amount','contribution_amount','contribution_frequency','preferred_debit_time','start_date',
    'maturity_date','source_mode','saved_payment_method_id','status','break_fee_percent','terms_accepted_at',
    'non_withdrawable_accepted_at','auto_debit_authorized_at','early_end_fee_accepted_at','completed_at',
    'future_debits_cancelled_at','cancelled_at','spent_at','applied_order_id','created_at','updated_at']),
  ('savings_notifications','events','source.goal_id=%2$L::uuid',ARRAY[
    'id','merchant_id','customer_id','goal_id','event_key','type','due_period_start','created_at','read_at',
    'voided_at','push_expanded_at']),
  ('savings_notifications','deliveries','source.notification_id IN (
    SELECT event.id FROM savings_notifications.events event WHERE event.goal_id=%2$L::uuid)',ARRAY[
    'notification_id','status','claimed_at','ticket_id']),
  ('prefunded_card','treasury_bindings','source.id=%4$L::uuid',ARRAY[
    'id','integration_id','merchant_id','expected_business_id','source_wallet_id','currency','verified_available_kobo',
    'reserved_kobo','consumed_kobo','verified_at','authorized_login','enabled'])
), witnesses AS MATERIALIZED (
  SELECT format('%I.%I',entry.namespace,entry.relation) name,
    query_to_xml(format($witness$
      WITH selected AS MATERIALIZED (
        SELECT to_jsonb(source) payload,(%s) IS TRUE target FROM %I.%I source
      ) SELECT jsonb_build_object(
        'excludedTargetCount',count(*) FILTER (WHERE NOT target),
        'excludedTargetHash',encode(sha256(convert_to(coalesce(jsonb_agg(payload
          ORDER BY payload::text COLLATE "C") FILTER (WHERE NOT target),'[]'::jsonb)::text,'UTF8')),'hex'),
        'targetCount',count(*) FILTER (WHERE target),
        'targetHash',encode(sha256(convert_to(coalesce(jsonb_agg(payload
          ORDER BY payload::text COLLATE "C") FILTER (WHERE target),'[]'::jsonb)::text,'UTF8')),'hex'),
        'targetRows',coalesce(jsonb_agg(coalesce((SELECT jsonb_object_agg(cell.key,cell.value)
          FROM jsonb_each(payload) cell WHERE cell.key=ANY(%L::text[])
          AND jsonb_typeof(cell.value) IN ('string','number','boolean','null')),'{}'::jsonb)
          ORDER BY payload::text COLLATE "C") FILTER (WHERE target),'[]'::jsonb),
        'targetRowColumnHashes',coalesce(jsonb_agg((SELECT jsonb_object_agg(cell.key,
          encode(sha256(convert_to(cell.value::text,'UTF8')),'hex')) FROM jsonb_each(payload) cell)
          ORDER BY payload::text COLLATE "C") FILTER (WHERE target),'[]'::jsonb),
        'redactedColumns',(SELECT coalesce(jsonb_agg(attribute.attname ORDER BY attribute.attnum),'[]'::jsonb)
          FROM pg_attribute attribute WHERE attribute.attrelid=%L::regclass AND attribute.attnum>0
          AND NOT attribute.attisdropped AND attribute.attname<>ALL(%L::text[]))
      ) evidence FROM selected
    $witness$,format(entry.predicate,scope.operation_id,scope.new_goal_id,scope.idempotency_key,scope.treasury_id),
      entry.namespace,entry.relation,entry.visible_columns,format('%I.%I',entry.namespace,entry.relation),
      entry.visible_columns),false,false,'') payload
  FROM allowed_targets entry CROSS JOIN scope
)
SELECT full_snapshot.evidence || jsonb_build_object(
  'readOnly',current_setting('transaction_read_only')='on',
  'sourceClosureSha256','680b3b7d0c5d49eb24f2f898356cbc6c5bd90916c511a90fda8faa5ea2fc8d79',
  'baselineSnapshotSha256','680b3b7d0c5d49eb24f2f898356cbc6c5bd90916c511a90fda8faa5ea2fc8d79',
  'financialSnapshotVersion',1,
  'scope',jsonb_build_object('operationId',scope.operation_id,'newGoalId',scope.new_goal_id,
    'oldGoalId',scope.old_goal_id,'treasuryBindingId',scope.treasury_id,'idempotencyKey',scope.idempotency_key),
  'allowedTargetWitnesses',(SELECT jsonb_object_agg(witness.name,parsed.evidence::jsonb) FROM witnesses witness
    CROSS JOIN XMLTABLE('/table/row' PASSING witness.payload COLUMNS evidence text PATH 'evidence') parsed)
) evidence FROM full_snapshot CROSS JOIN scope;
DO $financial_deadline$ BEGIN
  IF clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz THEN
    RAISE EXCEPTION 'financial_snapshot_identity_refused' USING ERRCODE='42501';
  END IF;
END $financial_deadline$;
ROLLBACK;

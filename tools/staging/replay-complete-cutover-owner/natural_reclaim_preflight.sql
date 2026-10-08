BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL timezone='UTC';
SET LOCAL datestyle='ISO, YMD';
SET LOCAL intervalstyle='postgres';
SET LOCAL extra_float_digits=3;
SET LOCAL stats_fetch_consistency='none';
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $natural_identity$ BEGIN
  IF session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
    OR current_database() IS DISTINCT FROM 'postgres'
    OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
    OR (SELECT usename FROM pg_stat_activity WHERE pid=pg_backend_pid()) IS DISTINCT FROM 'postgres'
    OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7685292944002592802'
    OR clock_timestamp()>='2026-10-06T15:49:10Z'::timestamptz
    OR current_setting('transaction_read_only') IS DISTINCT FROM 'on'
    OR current_setting('transaction_isolation') IS DISTINCT FROM 'repeatable read'
    OR current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
    RAISE EXCEPTION 'natural_reclaim_refused' USING ERRCODE='42501';
  END IF;
END $natural_identity$;
WITH moment AS MATERIALIZED (SELECT clock_timestamp() at),
expected AS MATERIALIZED (
  SELECT 'd8bcf921-61b3-4647-90e2-5648e4d6967d'::uuid old_id,
    'ff561046-58e7-428d-9163-f6e60b0dab65'::uuid target_id
), operation_rows AS MATERIALIZED (
  SELECT operation.id,operation.verification_token IS NOT NULL token_present,
    operation.verification_lease_expires_at expiry,
    jsonb_build_object('id',operation.id,
      'rowSha256',encode(sha256(convert_to(to_jsonb(operation)::text,'UTF8')),'hex'),
      'tokenSha256',encode(sha256(convert_to(operation.verification_token::text,'UTF8')),'hex'),
      'verificationFence',operation.verification_fence,'transferFence',operation.transfer_fence,
      'leaseExpiresAt',to_char(operation.verification_lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'checkoutRetired',operation.checkout_retired,'collectionStatus',operation.collection_status,
      'transferStatus',operation.transfer_status,'projectionStatus',operation.projection_status,
      'transferProviderTransactionId',operation.transfer_provider_transaction_id) payload
  FROM prefunded_card.operations operation
), leases(kind,token_present,expiry) AS MATERIALIZED (
  SELECT 'verification',token_present,expiry FROM operation_rows
  UNION ALL SELECT 'initialization',initialization_token IS NOT NULL,initialization_lease_expires_at
    FROM prefunded_card.checkout_intents
  UNION ALL SELECT 'dispatch',claim_token IS NOT NULL,lease_expires_at FROM prefunded_card.dispatch_queue
), drain AS MATERIALIZED (
  SELECT jsonb_build_object(
    'preparedTransactions',(SELECT count(*) FROM pg_prepared_xacts),
    'otherClientTransactions',(SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid()
      AND backend_type='client backend' AND xact_start IS NOT NULL),
    'activeVerificationLeases',count(*) FILTER (WHERE kind='verification' AND expiry>moment.at),
    'activeInitializationLeases',count(*) FILTER (WHERE kind='initialization' AND expiry>moment.at),
    'activeDispatchLeases',count(*) FILTER (WHERE kind='dispatch' AND expiry>moment.at),
    'malformedVerificationPairs',count(*) FILTER (WHERE kind='verification' AND token_present<>(expiry IS NOT NULL)),
    'malformedInitializationPairs',count(*) FILTER (WHERE kind='initialization' AND token_present<>(expiry IS NOT NULL)),
    'malformedDispatchPairs',count(*) FILTER (WHERE kind='dispatch' AND token_present<>(expiry IS NOT NULL)),
    'expiredVerificationPairs',count(*) FILTER (WHERE kind='verification' AND token_present AND expiry<=moment.at),
    'expiredInitializationPairs',count(*) FILTER (WHERE kind='initialization' AND token_present AND expiry<=moment.at),
    'expiredDispatchPairs',count(*) FILTER (WHERE kind='dispatch' AND token_present AND expiry<=moment.at)
  ) payload FROM leases CROSS JOIN moment
), phase AS MATERIALIZED (
  SELECT CASE WHEN payload->>'projectionStatus'='unapplied' AND payload->>'transferStatus'='dispatching'
      THEN 'verify_existing_transfer'
    WHEN payload->>'projectionStatus'='unapplied' AND payload->>'transferStatus'='verified_success'
      AND payload->>'transferProviderTransactionId'='PVB01M3YP6SFJQTJQWE83SC5RMX1V'
      THEN 'apply_verified_projection' ELSE NULL END name
  FROM expected LEFT JOIN operation_rows ON id=target_id
), retirement AS MATERIALIZED (
  SELECT jsonb_build_object('id',stored.operation_id,'intentId',stored.intent_id,
    'rowSha256',encode(sha256(convert_to(to_jsonb(stored)::text,'UTF8')),'hex'),
    'retiredAt',to_char(stored.retired_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) payload
  FROM expected LEFT JOIN prefunded_card.checkout_retirements stored ON stored.operation_id=old_id
), retired_intent AS MATERIALIZED (
  SELECT jsonb_build_object('id',intent.id,'operationId',intent.operation_id,'phase',intent.phase,
    'rowSha256',encode(sha256(convert_to(to_jsonb(intent)::text,'UTF8')),'hex')) payload
  FROM expected LEFT JOIN prefunded_card.checkout_intents intent ON intent.operation_id=old_id
), signatures(name) AS MATERIALIZED (VALUES
  ('claim_due(uuid,text,text,integer,uuid,uuid)'),('claim_reconciliation(uuid,integer)'),
  ('complete_reconciliation(uuid,uuid,bigint,text,text,jsonb)'),('record_transfer(uuid,bigint,text,jsonb)'),
  ('lock_scoped_operation(uuid,boolean)'),('checkout_is_retired(uuid)'),
  ('guard_retired_checkout_operation()'),('guard_retired_checkout_credit()'),('reject_projection_mutation()'),
  ('guard_first_card_checkout_intent()')
), routines AS MATERIALIZED (
  SELECT signatures.name,
    encode(sha256(convert_to((to_jsonb(routine)-'prosrc')::text,'UTF8')),'hex') metadata_sha,
    jsonb_build_object('oid',routine.oid::bigint,'ownerOid',routine.proowner::bigint,
      'owner',pg_get_userbyid(routine.proowner),'language',language.lanname,
      'securityDefiner',routine.prosecdef,'configuration',routine.proconfig,
      'acl',(SELECT coalesce(jsonb_agg(entry::text ORDER BY entry::text COLLATE "C"),'[]'::jsonb)
        FROM unnest(routine.proacl) entry),
      'bodySha256',encode(sha256(convert_to(routine.prosrc,'UTF8')),'hex'),
      'metadataSha256',encode(sha256(convert_to((to_jsonb(routine)-'prosrc')::text,'UTF8')),'hex'),
      'returnType',format_type(routine.prorettype,NULL),'kind',routine.prokind,
      'volatility',routine.provolatile,'parallel',routine.proparallel,'strict',routine.proisstrict,
      'leakproof',routine.proleakproof,'argumentDefaults',routine.pronargdefaults) payload
  FROM signatures LEFT JOIN pg_proc routine ON routine.oid=to_regprocedure('prefunded_card.'||signatures.name)::oid
    LEFT JOIN pg_language language ON language.oid=routine.prolang
), trigger_names(table_name,name) AS MATERIALIZED (VALUES
  ('prefunded_card.provider_aliases','checkout_retired_alias_guard'),
  ('piggyvest_savings_ledger.operations','checkout_retired_ledger_guard'),
  ('prefunded_card.operations','checkout_retired_operation_guard'),
  ('prefunded_card.projections','checkout_retired_projection_guard'),
  ('prefunded_card.checkout_retirements','checkout_retirements_immutable'),
  ('prefunded_card.checkout_retirements','checkout_retirements_no_truncate'),
  ('prefunded_card.checkout_intents','prefunded_first_card_checkout_intent_guard'),
  ('prefunded_card.checkout_intents','prefunded_first_card_checkout_intent_no_truncate')
), triggers AS MATERIALIZED (
  SELECT names.table_name,names.name,
    encode(sha256(convert_to(to_jsonb(stored)::text,'UTF8')),'hex') metadata_sha,
    jsonb_build_object('table',names.table_name,'name',names.name,'functionOid',stored.tgfoid::bigint,
      'type',stored.tgtype::integer,'enabled',stored.tgenabled,'internal',stored.tgisinternal,
      'argumentCount',stored.tgnargs::integer,'hasCondition',stored.tgqual IS NOT NULL,
      'constraintTrigger',stored.tgconstraint<>0,
      'metadataSha256',encode(sha256(convert_to(to_jsonb(stored)::text,'UTF8')),'hex')) payload
  FROM trigger_names names LEFT JOIN pg_trigger stored
    ON stored.tgrelid=to_regclass(names.table_name)::oid AND stored.tgname=names.name
), catalog_lines AS MATERIALIZED (
  SELECT 'function:'||name||':'||metadata_sha line FROM routines
  UNION ALL SELECT 'trigger:'||table_name||'.'||name||':'||metadata_sha FROM triggers
)
SELECT jsonb_build_object('version',1,'phase',phase.name,
  'sourceClosureSha256','e03d299d3e4663e55c8c6d4fa8159380e46c3ff8de816ab11119cb91923422e7',
  'capturedAt',to_char(moment.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'identity',jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
    'database',current_database(),'databaseOid',(SELECT oid::bigint FROM pg_database WHERE datname=current_database()),
    'roleOid',(SELECT oid::bigint FROM pg_roles WHERE rolname=current_user),'sessionUser',session_user,
    'currentUser',current_user,'localSocket',inet_client_addr() IS NULL,'readOnly',current_setting('transaction_read_only')='on',
    'isolation',current_setting('transaction_isolation'),'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),
    'replicationRole',current_setting('session_replication_role')),
  'drain',drain.payload,
  'operations',coalesce((SELECT jsonb_agg(payload ORDER BY id) FROM operation_rows WHERE id IN (old_id,target_id)),'[]'::jsonb),
  'expiredPairs',coalesce((SELECT jsonb_agg(payload ORDER BY id) FROM operation_rows WHERE token_present AND expiry<=moment.at),'[]'::jsonb),
  'retirement',retirement.payload,'retiredIntent',retired_intent.payload,
  'routines',(SELECT jsonb_object_agg(name,payload) FROM routines),
  'triggers',(SELECT jsonb_agg(payload ORDER BY table_name COLLATE "C",name COLLATE "C") FROM triggers),
  'catalogSha256',(SELECT encode(sha256(convert_to(string_agg(line,E'\n' ORDER BY line COLLATE "C"),'UTF8')),'hex') FROM catalog_lines)
) evidence FROM expected CROSS JOIN moment CROSS JOIN drain CROSS JOIN phase CROSS JOIN retirement CROSS JOIN retired_intent;
DO $natural_deadline$ BEGIN
  IF clock_timestamp()>='2026-10-06T15:49:10Z'::timestamptz THEN
    RAISE EXCEPTION 'natural_reclaim_refused' USING ERRCODE='42501';
  END IF;
END $natural_deadline$;
ROLLBACK;

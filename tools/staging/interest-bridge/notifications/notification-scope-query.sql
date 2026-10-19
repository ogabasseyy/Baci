BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL timezone='UTC';
SET LOCAL datestyle='ISO, YMD';
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
DO $identity$ BEGIN
  IF session_user<>'postgres' OR current_user<>'postgres' OR current_database()<>'postgres'
    OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system())<>'7685292944002592802'
    OR current_setting('transaction_read_only')<>'on'
    OR current_setting('transaction_isolation')<>'repeatable read'
    OR current_setting('session_replication_role')<>'origin'
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz THEN
    RAISE EXCEPTION 'notification_scope_identity_refused' USING ERRCODE='42501';
  END IF;
END $identity$;
WITH goals AS MATERIALIZED (
  SELECT goal.*, customer.user_id actor FROM public.customer_savings_goals goal
  JOIN public.customers customer ON customer.id=goal.customer_id AND customer.merchant_id=goal.merchant_id
  WHERE goal.status='active' AND customer.user_id IS NOT NULL AND customer.deleted_at IS NULL
), events AS MATERIALIZED (
  SELECT event.*, customer.user_id actor FROM savings_notifications.events event
  LEFT JOIN public.customers customer ON customer.id=event.customer_id AND customer.merchant_id=event.merchant_id
), tokens AS MATERIALIZED (
  SELECT token.* FROM public.push_tokens token WHERE token.is_active AND token.app_type='storefront'
), worker AS MATERIALIZED (
  SELECT * FROM pg_roles WHERE rolname='baci_savings_notifications_worker'
), routines AS MATERIALIZED (
  SELECT routine.*, language.lanname FROM pg_proc routine
  JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
  JOIN pg_language language ON language.oid=routine.prolang WHERE namespace.nspname='savings_notifications'
)
SELECT jsonb_build_object(
  'scope',jsonb_build_object(
    'capturedAt',clock_timestamp(),
    'goals',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'merchant',merchant_id,
      'customer',customer_id,'actor',actor,'rowSha256',encode(sha256(convert_to((to_jsonb(goals)-'actor')::text,'UTF8')),'hex'))
      ORDER BY id) FROM goals),'[]'::jsonb),
    'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'merchant',merchant_id,
      'customer',customer_id,'actor',actor,'goal',goal_id,'eventKey',event_key,'type',type,
      'createdAt',created_at,'expandedAt',push_expanded_at,
      'rowSha256',encode(sha256(convert_to((to_jsonb(events)-'actor')::text,'UTF8')),'hex'),
      'immutableSha256',encode(sha256(convert_to((to_jsonb(events)-'actor'-'push_expanded_at')::text,'UTF8')),'hex'),
      'contentSha256',encode(sha256(convert_to((to_jsonb(events)-'actor'-'id'-'created_at'-'push_expanded_at')::text,'UTF8')),'hex'))
      ORDER BY id) FROM events),'[]'::jsonb),
    'tokens',coalesce((SELECT jsonb_agg(jsonb_build_object('merchant',merchant_id,'actor',user_id,
      'tokenSha256',encode(sha256(convert_to(token,'UTF8')),'hex'),
      'rowSha256',encode(sha256(convert_to(to_jsonb(tokens)::text,'UTF8')),'hex'))
      ORDER BY encode(sha256(convert_to(token,'UTF8')),'hex')) FROM tokens),'[]'::jsonb),
    'deliveries',coalesce((SELECT jsonb_agg(jsonb_build_object('notificationId',notification_id,
      'tokenSha256',encode(sha256(convert_to(push_token,'UTF8')),'hex'),'status',status,'claimedAt',claimed_at,
      'ticketSha256',CASE WHEN ticket_id IS NULL THEN NULL ELSE encode(sha256(convert_to(ticket_id,'UTF8')),'hex') END,
      'receiptError',receipt_error,'rowSha256',encode(sha256(convert_to(to_jsonb(delivery)::text,'UTF8')),'hex'),
      'columnHashes',(SELECT jsonb_object_agg(key,encode(sha256(convert_to(value::text,'UTF8')),'hex'))
        FROM jsonb_each(to_jsonb(delivery)))) ORDER BY notification_id,encode(sha256(convert_to(push_token,'UTF8')),'hex'))
      FROM savings_notifications.deliveries delivery),'[]'::jsonb),
    'tables',jsonb_build_object(
      'savings_notifications.events',(SELECT jsonb_build_object('oid','savings_notifications.events'::regclass::oid::bigint,
        'count',count(*),'sha256',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(source)
        ORDER BY to_jsonb(source)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex')) FROM savings_notifications.events source),
      'savings_notifications.deliveries',(SELECT jsonb_build_object('oid','savings_notifications.deliveries'::regclass::oid::bigint,
        'count',count(*),'sha256',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(source)
        ORDER BY to_jsonb(source)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex')) FROM savings_notifications.deliveries source))),
  'database',jsonb_build_object(
    'role',(SELECT jsonb_build_object('exists',true,'canLogin',rolcanlogin,'inherit',rolinherit,
      'superuser',rolsuper,'bypassRls',rolbypassrls,'createDb',rolcreatedb,'createRole',rolcreaterole,
      'replication',rolreplication,'configIsNull',rolconfig IS NULL,
      'validUntil',to_char(rolvaliduntil AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'memberCount',(SELECT count(*) FROM pg_auth_members WHERE member=worker.oid OR roleid=worker.oid)) FROM worker),
    'routines',(SELECT jsonb_agg(jsonb_build_object('signature',proname||'('||oidvectortypes(proargtypes)||')',
      'bodyMd5',md5(prosrc),'language',lanname,'owner',pg_get_userbyid(proowner),'securityDefiner',prosecdef,
      'config',proconfig,'acl',proacl::text) ORDER BY proname,proargtypes) FROM routines),
    'directExecutions',(SELECT coalesce(jsonb_agg(routine.oid::regprocedure::text ORDER BY routine.oid),'[]'::jsonb)
      FROM pg_proc routine,worker WHERE EXISTS(SELECT 1 FROM aclexplode(coalesce(routine.proacl,
        acldefault('f'::"char",routine.proowner))) grant_row WHERE grant_row.grantee=worker.oid)),
    'effectiveDefiners',(SELECT coalesce(jsonb_agg(routine.oid::regprocedure::text ORDER BY routine.oid),'[]'::jsonb)
      FROM pg_proc routine,worker WHERE routine.prosecdef AND has_schema_privilege(worker.oid,routine.pronamespace,'USAGE')
      AND has_function_privilege(worker.oid,routine.oid,'EXECUTE')))) AS value;
ROLLBACK;

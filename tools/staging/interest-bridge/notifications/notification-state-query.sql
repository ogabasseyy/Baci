WITH worker AS (SELECT oid, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolcreatedb,
  rolcreaterole, rolreplication, rolvaliduntil, rolconfig FROM pg_catalog.pg_roles
  WHERE rolname='baci_savings_notifications_worker'), target AS (
  SELECT '10000000-0000-4000-8000-000000000001'::uuid AS merchant,
    '10000000-0000-4000-8000-000000000002'::uuid AS customer,
    '430314fd-cd8b-4579-98d4-e9f345713dd6'::uuid AS goal
)
SELECT jsonb_build_object(
  'systemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'database',current_database(),'sessionUser',session_user,'localSocket',inet_client_addr() IS NULL,
  'role',(SELECT jsonb_build_object('exists',worker.oid IS NOT NULL,'canLogin',worker.rolcanlogin,
    'inherit',worker.rolinherit,'superuser',worker.rolsuper,'bypassRls',worker.rolbypassrls,
    'createDb',worker.rolcreatedb,'createRole',worker.rolcreaterole,'replication',worker.rolreplication,
    'configIsNull',worker.rolconfig IS NULL,
    'validUntil',to_char(worker.rolvaliduntil AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'memberCount',(SELECT count(*) FROM pg_catalog.pg_auth_members membership
      WHERE membership.member=worker.oid OR membership.roleid=worker.oid))
    FROM (VALUES(1)) singleton(value) LEFT JOIN worker ON true),
  'routines',(SELECT jsonb_agg(jsonb_build_object(
    'signature',routine.proname||'('||pg_catalog.oidvectortypes(routine.proargtypes)||')',
    'bodyMd5',md5(routine.prosrc),'owner',pg_catalog.pg_get_userbyid(routine.proowner),
    'securityDefiner',routine.prosecdef,'config',routine.proconfig,'language',language.lanname,'acl',routine.proacl::text)
    ORDER BY routine.proname, routine.proargtypes)
    FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace namespace ON namespace.oid=routine.pronamespace
    JOIN pg_catalog.pg_language language ON language.oid=routine.prolang WHERE namespace.nspname='savings_notifications'),
  'goalMatches',(SELECT count(*) FROM public.customer_savings_goals goal,target
    WHERE goal.id=target.goal AND goal.customer_id=target.customer AND goal.merchant_id=target.merchant AND goal.status='active'),
  'goalAmount',(SELECT current_amount FROM public.customer_savings_goals goal,target
    WHERE goal.id=target.goal AND goal.customer_id=target.customer AND goal.merchant_id=target.merchant),
  'principalKobo',(SELECT coalesce(sum(posting.amount_kobo),0) FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations operation ON operation.id=posting.operation_id,target
    WHERE operation.goal_id=target.goal AND operation.customer_id=target.customer AND operation.merchant_id=target.merchant
      AND posting.account IN ('principal','purchase_principal','refund_principal')),
  'otherEligibleGoals',(SELECT count(*) FROM public.customer_savings_goals goal
    JOIN public.customers customer ON customer.id=goal.customer_id AND customer.merchant_id=goal.merchant_id,target
    WHERE goal.status='active' AND customer.user_id IS NOT NULL AND customer.deleted_at IS NULL
      AND (goal.id<>target.goal OR goal.customer_id<>target.customer OR goal.merchant_id<>target.merchant)),
  'otherEvents',(SELECT count(*) FROM savings_notifications.events event,target WHERE
    event.goal_id<>target.goal OR event.customer_id<>target.customer OR event.merchant_id<>target.merchant),
  'orphanDeliveries',(SELECT count(*) FROM savings_notifications.deliveries delivery
    LEFT JOIN savings_notifications.events event ON event.id=delivery.notification_id WHERE event.id IS NULL),
  'unscopedActiveTokens',(SELECT count(*) FROM public.push_tokens token,target
    WHERE token.is_active AND token.app_type='storefront' AND token.merchant_id=target.merchant
    AND NOT EXISTS(SELECT 1 FROM public.customers customer WHERE customer.id=target.customer
      AND customer.merchant_id=target.merchant AND customer.user_id=token.user_id)),
  'eventCount',(SELECT count(*) FROM savings_notifications.events),
  'deliveryCount',(SELECT count(*) FROM savings_notifications.deliveries)
) AS value;

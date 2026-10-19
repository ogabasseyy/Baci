BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL search_path = pg_catalog;

DO $$
BEGIN
  IF current_database() <> 'postgres'
    OR (SELECT system_identifier::text FROM pg_control_system()) <> '7685292944002592802'
    OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'notification readiness database identity refused';
  END IF;
END
$$;

WITH target AS (
  SELECT '10000000-0000-4000-8000-000000000001'::uuid AS merchant_id,
         '10000000-0000-4000-8000-000000000002'::uuid AS customer_id,
         '430314fd-cd8b-4579-98d4-e9f345713dd6'::uuid AS goal_id
), role_state AS (
  SELECT jsonb_build_object(
    'exists', role.oid IS NOT NULL,
    'canLogin', role.rolcanlogin,
    'inherit', role.rolinherit,
    'superuser', role.rolsuper,
    'bypassRls', role.rolbypassrls,
    'createDb', role.rolcreatedb,
    'createRole', role.rolcreaterole,
    'replication', role.rolreplication,
    'validUntil', role.rolvaliduntil,
    'memberCount', (SELECT count(*) FROM pg_auth_members membership
      WHERE membership.member = role.oid OR membership.roleid = role.oid)
  ) AS value
  FROM (VALUES (1)) singleton(value)
  LEFT JOIN pg_roles role ON role.rolname = 'baci_savings_notifications_worker'
), goal_state AS (
  SELECT jsonb_build_object(
    'matches', count(goal.id) = 1,
    'status', min(goal.status),
    'currentAmount', min(goal.current_amount),
    'targetAmount', min(goal.target_amount)
  ) AS value
  FROM target
  LEFT JOIN public.customer_savings_goals goal
    ON goal.id = target.goal_id AND goal.customer_id = target.customer_id
   AND goal.merchant_id = target.merchant_id
), event_state AS (
  SELECT jsonb_build_object('count', coalesce(sum(type_count), 0),
    'types', coalesce(jsonb_object_agg(type, type_count), '{}'::jsonb)) AS value
  FROM (
    SELECT event.type, count(*) AS type_count
    FROM target
    JOIN savings_notifications.events event
      ON event.merchant_id = target.merchant_id
     AND event.customer_id = target.customer_id AND event.goal_id = target.goal_id
    GROUP BY event.type
  ) counts
), delivery_state AS (
  SELECT jsonb_build_object('count', coalesce(sum(status_count), 0),
    'statuses', coalesce(jsonb_object_agg(status, status_count), '{}'::jsonb)) AS value
  FROM (
    SELECT delivery.status, count(*) AS status_count
    FROM target
    JOIN savings_notifications.events event
      ON event.merchant_id = target.merchant_id
     AND event.customer_id = target.customer_id AND event.goal_id = target.goal_id
    JOIN savings_notifications.deliveries delivery ON delivery.notification_id = event.id
    GROUP BY delivery.status
  ) counts
), grant_state AS (
  SELECT jsonb_build_object(
    'requiredFunctionsExecute', coalesce((SELECT bool_and(has_function_privilege(
      'baci_savings_notifications_worker', function_name, 'EXECUTE'))
      FROM unnest(ARRAY[
        'savings_notifications.enqueue_due()',
        'savings_notifications.claim_push(integer)',
        'savings_notifications.finish_push(uuid,text,uuid,text,text)',
        'savings_notifications.pending_receipts(integer)',
        'savings_notifications.record_receipt(text,text,text)'
      ]) AS required(function_name)
      WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baci_savings_notifications_worker')), false),
    'tablePrivileges', coalesce((SELECT count(*) FROM information_schema.role_table_grants
      WHERE grantee = 'baci_savings_notifications_worker'), 0),
    'databaseCreate', CASE WHEN EXISTS (SELECT 1 FROM pg_roles
      WHERE rolname = 'baci_savings_notifications_worker') THEN has_database_privilege(
      'baci_savings_notifications_worker', current_database(), 'CREATE') ELSE false END,
    'databaseTemp', CASE WHEN EXISTS (SELECT 1 FROM pg_roles
      WHERE rolname = 'baci_savings_notifications_worker') THEN has_database_privilege(
      'baci_savings_notifications_worker', current_database(), 'TEMP') ELSE false END
  ) AS value
)
SELECT jsonb_build_object(
  'database', current_database(),
  'systemIdentifier', (SELECT system_identifier::text FROM pg_control_system()),
  'role', (SELECT value FROM role_state),
  'grantSummary', (SELECT value FROM grant_state),
  'syntheticGoal', (SELECT value FROM goal_state),
  'scopedEvents', (SELECT value FROM event_state),
  'scopedDeliveries', (SELECT value FROM delivery_state),
  'providerCallsMade', false,
  'servicesStarted', false
);

ROLLBACK;

-- REGRESSION TEST: order_refund_events grant pins.
--
-- Authenticated staff read audit events directly through REST, so the
-- table's column grant IS the masking contract for that path: the
-- route mask cannot protect direct readers. Pin the exact granted
-- SELECT set (actor_id stays out like the route mask drops it) and
-- the absence of direct writes, so a future migration cannot widen
-- the grant silently. No fixtures: catalog assertions only; rolls
-- back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_event_grant_pins.sql

BEGIN;

DO $refund_event_grant_pins$
DECLARE
  v_granted text[];
  v_expected text[] := ARRAY[
    'action', 'created_at', 'details', 'id', 'merchant_id', 'order_id'
  ];
BEGIN
  -- Exact SELECT column set for authenticated: no more, no less.
  SELECT COALESCE(array_agg(priv.column_name ORDER BY priv.column_name),
    '{}')
    INTO v_granted
    FROM information_schema.column_privileges priv
   WHERE priv.grantee = 'authenticated'
     AND priv.table_schema = 'public'
     AND priv.table_name = 'order_refund_events'
     AND priv.privilege_type = 'SELECT';
  IF v_granted IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'event SELECT grant drifted to %, want %',
      v_granted, v_expected;
  END IF;
  -- actor_id is readable by neither REST role: the timeline never
  -- renders peer identity, and the route mask drops it too.
  IF pg_catalog.has_column_privilege(
    'authenticated', 'public.order_refund_events', 'actor_id', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'authenticated gained event actor_id reads';
  END IF;
  IF pg_catalog.has_column_privilege(
    'anon', 'public.order_refund_events', 'action', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'anon gained event reads';
  END IF;
  -- Direct writes stay closed: all event rows come from triggers.
  IF pg_catalog.has_table_privilege(
    'authenticated', 'public.order_refund_events', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'authenticated gained direct event inserts';
  END IF;
  IF pg_catalog.has_table_privilege(
    'authenticated', 'public.order_refund_events', 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'authenticated gained direct event updates';
  END IF;
  IF pg_catalog.has_table_privilege(
    'authenticated', 'public.order_refund_events', 'DELETE'
  ) THEN
    RAISE EXCEPTION 'authenticated gained direct event deletes';
  END IF;
  -- The service path keeps full access: the pin must not mistake a
  -- broken grant setup for a tight one.
  IF NOT pg_catalog.has_table_privilege(
    'service_role', 'public.order_refund_events', 'SELECT,INSERT,UPDATE,DELETE'
  ) THEN
    RAISE EXCEPTION 'service_role lost event access';
  END IF;
END;
$refund_event_grant_pins$;

ROLLBACK;

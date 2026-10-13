-- REGRESSION TEST: notification dashboard totals preserve literal LIKE search.
-- Run in an isolated PostgreSQL database:
--   psql -X -v ON_ERROR_STOP=1 -f supabase/tests/admin_notification_dashboard_literal_search.sql

BEGIN;

CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA private;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT '00000000-0000-0000-0000-000000000001'::uuid;
$$;
CREATE FUNCTION private.has_platform_admin_permission_v1(uuid, text)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT TRUE; $$;

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  message text NOT NULL,
  sent_at timestamptz,
  scheduled_for timestamptz,
  expires_at timestamptz,
  channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivery_state text NOT NULL DEFAULT 'sent',
  notification_type text NOT NULL DEFAULT 'info',
  priority text NOT NULL DEFAULT 'normal'
);
CREATE TABLE public.merchant_notifications (
  notification_id uuid NOT NULL,
  read_at timestamptz
);

INSERT INTO public.notifications (id, title, message, sent_at)
VALUES
  ('00000000-0000-0000-0000-000000000010', 'contains % marker', '', clock_timestamp()),
  ('00000000-0000-0000-0000-000000000011', 'plain marker', 'contains _ marker', clock_timestamp()),
  ('00000000-0000-0000-0000-000000000012', E'contains \\ marker', '', clock_timestamp()),
  ('00000000-0000-0000-0000-000000000013', 'contains x marker', '', clock_timestamp());

\ir ../migrations/20260809184000_repair_admin_notification_dashboard_literal_search.sql

DO $$
DECLARE
  v_search text;
  v_dashboard jsonb;
BEGIN
  FOREACH v_search IN ARRAY ARRAY['%', '_', E'\\'] LOOP
    v_dashboard := public.get_admin_notification_dashboard('sent', NULL, NULL, v_search);
    IF (v_dashboard ->> 'totalSent') IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'dashboard search for % must be literal; got %', v_search, v_dashboard;
    END IF;
  END LOOP;
END;
$$;

ROLLBACK;

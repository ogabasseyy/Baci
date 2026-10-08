BEGIN;
CREATE SCHEMA IF NOT EXISTS savings_notifications;
REVOKE ALL ON SCHEMA savings_notifications FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baci_savings_notifications_worker') THEN
    CREATE ROLE baci_savings_notifications_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baci_savings_notifications_worker'
    AND (rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
    OR EXISTS (SELECT 1 FROM pg_auth_members membership JOIN pg_roles worker ON worker.oid = membership.member
      WHERE worker.rolname = 'baci_savings_notifications_worker') THEN
    RAISE EXCEPTION 'Notification worker role is not restricted' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS savings_notifications.preferences (
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  encouragement_enabled boolean NOT NULL DEFAULT true,
  weekly_summary_enabled boolean NOT NULL DEFAULT false,
  interest_alerts_enabled boolean NOT NULL DEFAULT true,
  quiet_hours_start time NOT NULL DEFAULT '22:00',
  quiet_hours_end time NOT NULL DEFAULT '08:00',
  time_zone text NOT NULL DEFAULT 'Africa/Lagos',
  PRIMARY KEY (merchant_id, customer_id)
);
CREATE INDEX IF NOT EXISTS savings_notification_preferences_customer_idx ON savings_notifications.preferences(customer_id);
CREATE TABLE IF NOT EXISTS savings_notifications.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.customer_savings_goals(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  type text NOT NULL CHECK (type IN ('interest_credited','first_contribution','milestone','streak','missed_contribution','weekly_summary','goal_completed')),
  title text NOT NULL,
  body text NOT NULL,
  due_period_start timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  voided_at timestamptz,
  push_expanded_at timestamptz,
  UNIQUE (merchant_id, customer_id, goal_id, event_key)
);
CREATE INDEX IF NOT EXISTS savings_notification_events_customer_idx ON savings_notifications.events(customer_id, merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS savings_notification_events_goal_idx ON savings_notifications.events(goal_id);
CREATE INDEX IF NOT EXISTS savings_notification_events_pending_idx ON savings_notifications.events(created_at) WHERE push_expanded_at IS NULL AND voided_at IS NULL;
CREATE TABLE IF NOT EXISTS savings_notifications.deliveries (
  notification_id uuid NOT NULL REFERENCES savings_notifications.events(id) ON DELETE CASCADE,
  push_token text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','dispatching','accepted','rejected','unknown','suppressed')),
  claim_id uuid,
  claimed_at timestamptz,
  ticket_id text,
  PRIMARY KEY(notification_id, push_token)
);
CREATE INDEX IF NOT EXISTS savings_notification_deliveries_pending_idx ON savings_notifications.deliveries(status, claimed_at);
ALTER TABLE savings_notifications.preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_notifications.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_notifications.deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY savings_preferences_private ON savings_notifications.preferences USING (false) WITH CHECK (false);
CREATE POLICY savings_events_private ON savings_notifications.events USING (false) WITH CHECK (false);
CREATE POLICY savings_deliveries_private ON savings_notifications.deliveries USING (false) WITH CHECK (false);
REVOKE ALL ON ALL TABLES IN SCHEMA savings_notifications FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION savings_notifications.customer_for(p_merchant uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE customer uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT id INTO STRICT customer FROM public.customers WHERE merchant_id = p_merchant AND user_id = auth.uid() AND deleted_at IS NULL;
  RETURN customer;
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'Customer scope unavailable' USING ERRCODE = '42501';
END $$;

CREATE FUNCTION savings_notifications.preference_json(p_merchant uuid, p_customer uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'encouragementEnabled', coalesce(preferences.encouragement_enabled, true),
    'weeklySummaryEnabled', coalesce(preferences.weekly_summary_enabled, false),
    'interestAlertsEnabled', coalesce(preferences.interest_alerts_enabled, true),
    'quietHoursStart', to_char(coalesce(preferences.quiet_hours_start, '22:00'::time), 'HH24:MI'),
    'quietHoursEnd', to_char(coalesce(preferences.quiet_hours_end, '08:00'::time), 'HH24:MI'),
    'timeZone', coalesce(preferences.time_zone, 'Africa/Lagos'))
  FROM (SELECT 1) singleton LEFT JOIN savings_notifications.preferences
    ON merchant_id = p_merchant AND customer_id = p_customer;
$$;

CREATE FUNCTION public.get_customer_savings_earnings(p_merchant_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE customer uuid; earnings numeric;
BEGIN
  customer := savings_notifications.customer_for(p_merchant_id);
  SELECT coalesce(sum(CASE
    WHEN operation.command->>'kind' = 'credit_eligible_paid_interest' THEN (operation.command->>'interestKobo')::numeric
    WHEN operation.command->>'kind' = 'reverse_credit' AND original.command->>'kind' = 'credit_eligible_paid_interest'
      THEN -(original.command->>'interestKobo')::numeric
    ELSE 0 END), 0) INTO earnings
  FROM piggyvest_savings_ledger.operations operation
  LEFT JOIN piggyvest_savings_ledger.operations original ON original.id = operation.reference_id
    AND original.customer_id = operation.customer_id AND original.merchant_id = operation.merchant_id
  WHERE operation.merchant_id = p_merchant_id AND operation.customer_id = customer;
  IF earnings < 0 OR earnings > 9007199254740991 THEN
    RAISE EXCEPTION 'Earnings outside safe range' USING ERRCODE = '22003';
  END IF;
  RETURN jsonb_build_object('credited_interest_kobo', earnings);
END $$;

CREATE FUNCTION public.get_customer_savings_notifications(p_merchant_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE customer uuid; items jsonb;
BEGIN
  customer := savings_notifications.customer_for(p_merchant_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', item.id, 'goalId', item.goal_id,
    'type', item.type, 'title', item.title, 'body', item.body, 'createdAt', item.created_at,
    'readAt', item.read_at) ORDER BY item.created_at DESC, item.id), '[]'::jsonb) INTO items
  FROM (SELECT id, goal_id, type, title, body, created_at, read_at FROM savings_notifications.events
    WHERE merchant_id = p_merchant_id AND customer_id = customer AND voided_at IS NULL
    ORDER BY created_at DESC, id LIMIT 100) item;
  RETURN jsonb_build_object('notifications', items,
    'preferences', savings_notifications.preference_json(p_merchant_id, customer));
END $$;

CREATE FUNCTION public.update_customer_savings_notification_preferences(p_merchant_id uuid, p_preferences jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE customer uuid; item record; merged jsonb;
BEGIN
  customer := savings_notifications.customer_for(p_merchant_id);
  IF p_preferences IS NULL OR jsonb_typeof(p_preferences) <> 'object' OR p_preferences = '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid preferences' USING ERRCODE = '22023';
  END IF;
  FOR item IN SELECT key, value FROM jsonb_each(p_preferences) LOOP
    IF item.key IN ('encouragementEnabled','weeklySummaryEnabled','interestAlertsEnabled') THEN
      IF jsonb_typeof(item.value) <> 'boolean' THEN RAISE EXCEPTION 'Invalid preference boolean' USING ERRCODE = '22023'; END IF;
    ELSIF item.key IN ('quietHoursStart','quietHoursEnd') THEN
      IF jsonb_typeof(item.value) <> 'string' OR item.value #>> '{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION 'Invalid quiet hours' USING ERRCODE = '22023';
      END IF;
    ELSIF item.key = 'timeZone' THEN
      IF jsonb_typeof(item.value) <> 'string' OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = item.value #>> '{}') THEN
        RAISE EXCEPTION 'Invalid time zone' USING ERRCODE = '22023';
      END IF;
    ELSE RAISE EXCEPTION 'Unknown preference' USING ERRCODE = '22023'; END IF;
  END LOOP;
  INSERT INTO savings_notifications.preferences(merchant_id, customer_id) VALUES(p_merchant_id, customer) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM savings_notifications.preferences WHERE merchant_id = p_merchant_id AND customer_id = customer FOR UPDATE;
  merged := savings_notifications.preference_json(p_merchant_id, customer) || p_preferences;
  UPDATE savings_notifications.preferences SET
    encouragement_enabled = (merged->>'encouragementEnabled')::boolean,
    weekly_summary_enabled = (merged->>'weeklySummaryEnabled')::boolean,
    interest_alerts_enabled = (merged->>'interestAlertsEnabled')::boolean,
    quiet_hours_start = (merged->>'quietHoursStart')::time,
    quiet_hours_end = (merged->>'quietHoursEnd')::time,
    time_zone = merged->>'timeZone'
  WHERE merchant_id = p_merchant_id AND customer_id = customer;
  RETURN merged;
END $$;

CREATE FUNCTION public.mark_customer_savings_notification_read(p_merchant_id uuid, p_notification_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE customer uuid;
BEGIN
  customer := savings_notifications.customer_for(p_merchant_id);
  UPDATE savings_notifications.events SET read_at = coalesce(read_at, now())
    WHERE id = p_notification_id AND merchant_id = p_merchant_id AND customer_id = customer AND voided_at IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA savings_notifications FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_customer_savings_earnings(uuid), public.get_customer_savings_notifications(uuid),
  public.update_customer_savings_notification_preferences(uuid,jsonb), public.mark_customer_savings_notification_read(uuid,uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_savings_earnings(uuid), public.get_customer_savings_notifications(uuid),
  public.update_customer_savings_notification_preferences(uuid,jsonb), public.mark_customer_savings_notification_read(uuid,uuid) TO authenticated;
COMMIT;

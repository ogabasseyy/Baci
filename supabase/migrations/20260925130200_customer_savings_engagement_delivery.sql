BEGIN;
CREATE FUNCTION savings_notifications.push_allowed(p_event savings_notifications.events, p_quiet boolean DEFAULT true, p_now timestamptz DEFAULT now()) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE preferences jsonb; local_time time; quiet_start time; quiet_end time;
BEGIN
  IF p_event.voided_at IS NOT NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_event.customer_id
    AND merchant_id = p_event.merchant_id AND deleted_at IS NULL AND user_id IS NOT NULL) THEN RETURN false; END IF;
  preferences := savings_notifications.preference_json(p_event.merchant_id, p_event.customer_id);
  IF p_event.type = 'interest_credited' THEN
    IF NOT (preferences->>'interestAlertsEnabled')::boolean THEN RETURN false; END IF;
  ELSIF p_event.type = 'weekly_summary' THEN
    IF NOT (preferences->>'weeklySummaryEnabled')::boolean THEN RETURN false; END IF;
  ELSIF NOT (preferences->>'encouragementEnabled')::boolean THEN RETURN false;
  END IF;
  IF p_event.type <> 'interest_credited' AND NOT EXISTS (SELECT 1 FROM public.customer_savings_goals
    WHERE id = p_event.goal_id AND merchant_id = p_event.merchant_id AND customer_id = p_event.customer_id
      AND status IN ('active','completed')) THEN RETURN false; END IF;
  IF p_event.type = 'missed_contribution' AND (p_event.due_period_start IS NULL OR p_event.due_period_start > p_now
    OR NOT EXISTS (SELECT 1 FROM public.customer_savings_goals WHERE id = p_event.goal_id AND status = 'active')
    OR EXISTS (SELECT 1 FROM public.customer_savings_contributions WHERE goal_id = p_event.goal_id
      AND merchant_id = p_event.merchant_id AND customer_id = p_event.customer_id AND status = 'completed'
      AND coalesce(processed_at, created_at) >= p_event.due_period_start)) THEN RETURN false; END IF;
  IF NOT p_quiet THEN RETURN true; END IF;
  local_time := (p_now AT TIME ZONE (preferences->>'timeZone'))::time;
  quiet_start := (preferences->>'quietHoursStart')::time;
  quiet_end := (preferences->>'quietHoursEnd')::time;
  IF quiet_start = quiet_end THEN RETURN true; END IF;
  RETURN NOT (CASE WHEN quiet_start < quiet_end THEN local_time >= quiet_start AND local_time < quiet_end
    ELSE local_time >= quiet_start OR local_time < quiet_end END);
END $$;

CREATE FUNCTION savings_notifications.claim_push(p_limit integer DEFAULT 50)
RETURNS TABLE(notification_id uuid, claim_id uuid, push_token text, title text, body text, data jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE event savings_notifications.events%ROWTYPE; delivery record; claim uuid;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'Invalid claim limit' USING ERRCODE = '22023'; END IF;
  UPDATE savings_notifications.deliveries SET status = 'unknown'
    WHERE status = 'dispatching' AND claimed_at < now() - interval '10 minutes';
  FOR event IN SELECT candidate.* FROM savings_notifications.events candidate
    WHERE candidate.push_expanded_at IS NULL AND (candidate.created_at < now() - interval '7 days'
      OR NOT savings_notifications.push_allowed(candidate, false) OR savings_notifications.push_allowed(candidate, true))
    ORDER BY candidate.created_at, candidate.id LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
    IF event.created_at < now() - interval '7 days' OR NOT savings_notifications.push_allowed(event, false) THEN
      UPDATE savings_notifications.events SET push_expanded_at = now() WHERE id = event.id;
      CONTINUE;
    END IF;
    IF NOT savings_notifications.push_allowed(event, true) THEN CONTINUE; END IF;
    INSERT INTO savings_notifications.deliveries(notification_id, push_token)
      SELECT event.id, token.token FROM public.push_tokens token JOIN public.customers customer ON customer.user_id = token.user_id
      WHERE customer.id = event.customer_id AND customer.merchant_id = event.merchant_id
        AND token.merchant_id = event.merchant_id AND token.app_type = 'storefront' AND token.is_active
        AND token.token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$'
      ON CONFLICT DO NOTHING;
    UPDATE savings_notifications.events SET push_expanded_at = now() WHERE id = event.id;
  END LOOP;
  FOR delivery IN SELECT queued.notification_id, queued.push_token FROM savings_notifications.deliveries queued
    JOIN savings_notifications.events source_event ON source_event.id = queued.notification_id
    WHERE queued.status = 'pending' AND (NOT savings_notifications.push_allowed(source_event, false)
      OR savings_notifications.push_allowed(source_event, true))
    ORDER BY source_event.created_at, source_event.id, queued.push_token
    LIMIT p_limit FOR UPDATE OF queued SKIP LOCKED LOOP
    SELECT * INTO STRICT event FROM savings_notifications.events WHERE id = delivery.notification_id;
    IF event.created_at < now() - interval '7 days' OR NOT savings_notifications.push_allowed(event, false) OR NOT EXISTS (
      SELECT 1 FROM public.push_tokens token JOIN public.customers customer ON customer.user_id = token.user_id
        WHERE token.token = delivery.push_token AND token.is_active AND token.app_type = 'storefront'
          AND token.merchant_id = event.merchant_id AND customer.merchant_id = event.merchant_id AND customer.id = event.customer_id
    ) THEN
      UPDATE savings_notifications.deliveries SET status = 'suppressed'
        WHERE deliveries.notification_id = delivery.notification_id AND deliveries.push_token = delivery.push_token;
      CONTINUE;
    END IF;
    IF NOT savings_notifications.push_allowed(event, true) THEN CONTINUE; END IF;
    PERFORM 1 FROM public.customers WHERE id = event.customer_id AND merchant_id = event.merchant_id FOR UPDATE;
    IF event.type <> 'interest_credited' AND EXISTS (
      SELECT 1 FROM savings_notifications.deliveries recent JOIN savings_notifications.events previous ON previous.id = recent.notification_id
        WHERE previous.customer_id = event.customer_id AND previous.merchant_id = event.merchant_id
        AND previous.id <> event.id AND previous.type <> 'interest_credited'
        AND recent.status IN ('dispatching','accepted','unknown','provider_confirmed','receipt_unknown') AND recent.claimed_at > now() - interval '24 hours'
    ) THEN
      UPDATE savings_notifications.deliveries SET status = 'suppressed'
        WHERE deliveries.notification_id = delivery.notification_id AND deliveries.push_token = delivery.push_token;
      CONTINUE;
    END IF;
    claim := gen_random_uuid();
    UPDATE savings_notifications.deliveries SET status = 'dispatching', claim_id = claim, claimed_at = now()
      WHERE deliveries.notification_id = delivery.notification_id AND deliveries.push_token = delivery.push_token;
    RETURN QUERY SELECT event.id, claim, delivery.push_token::text, event.title, event.body,
      jsonb_build_object('type','savings','goalId',event.goal_id,'notificationId',event.id,'merchantId',event.merchant_id);
  END LOOP;
END $$;

CREATE FUNCTION savings_notifications.finish_push(p_notification_id uuid, p_push_token text, p_claim_id uuid,
  p_outcome text, p_ticket_id text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_outcome NOT IN ('accepted','rejected','unknown') OR p_outcome IS NULL OR p_claim_id IS NULL
    OR (p_outcome = 'accepted' AND (p_ticket_id IS NULL OR length(p_ticket_id) NOT BETWEEN 1 AND 256)) THEN
    RAISE EXCEPTION 'Invalid push outcome' USING ERRCODE = '22023';
  END IF;
  UPDATE savings_notifications.deliveries SET status = p_outcome, ticket_id = p_ticket_id
    WHERE notification_id = p_notification_id AND push_token = p_push_token AND claim_id = p_claim_id AND status = 'dispatching';
  RETURN FOUND;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA savings_notifications FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION savings_notifications.claim_push(integer),
  savings_notifications.finish_push(uuid,text,uuid,text,text) TO baci_savings_notifications_worker;
COMMIT;

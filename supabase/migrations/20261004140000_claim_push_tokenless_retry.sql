BEGIN;
-- claim_push previously marked an event expanded even when the customer had
-- no active storefront push token (zero delivery rows inserted). The event
-- then never resurfaced, so a token registered minutes later missed the
-- notification. Leave tokenless events unexpanded until at least one
-- delivery row exists; the seven-day expiry still bounds the retry window.
CREATE OR REPLACE FUNCTION savings_notifications.claim_push(p_limit integer DEFAULT 50)
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
    -- A tokenless customer yields zero delivery rows: leave the event
    -- unexpanded so a token registered later (within the seven-day
    -- expiry) still gets the notification on a subsequent claim run.
    IF EXISTS (SELECT 1 FROM savings_notifications.deliveries WHERE deliveries.notification_id = event.id) THEN
      UPDATE savings_notifications.events SET push_expanded_at = now() WHERE id = event.id;
    END IF;
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
COMMIT;

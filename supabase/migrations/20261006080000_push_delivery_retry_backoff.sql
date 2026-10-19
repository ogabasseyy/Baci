BEGIN;
-- Retryable push backoff: finish_push 'retryable' used to reset the delivery
-- to pending with no deferral, and the claim loop selects every pending row,
-- so one worker run re-claimed the same 429/5xx/timeout delivery on every
-- cycle (up to the run limit) instead of backing off. The 96-attempt budget
-- is sized as ~24h at the 15-minute cron; same-run re-claims could burn most
-- of it during a single outage and duplicate ambiguous timeouts.
--
-- deliveries.retry_after (NULL = immediately eligible) is now the backoff
-- clock: the claim loop skips rows whose retry_after is in the future, a
-- retryable finish stamps now() + 15 minutes, and every path that starts a
-- fresh send (claim, accept/reject/unregister/unknown finish, receipt
-- requeue) clears it so stale stamps never defer a new attempt.
ALTER TABLE savings_notifications.deliveries
  ADD COLUMN IF NOT EXISTS retry_after timestamptz;

CREATE OR REPLACE FUNCTION savings_notifications.claim_push(p_limit integer DEFAULT 50)
RETURNS TABLE(notification_id uuid, claim_id uuid, push_token text, title text, body text, data jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE event savings_notifications.events%ROWTYPE; delivery record; claim uuid;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'Invalid claim limit' USING ERRCODE = '22023'; END IF;
  UPDATE savings_notifications.deliveries SET status = 'unknown'
    WHERE status = 'dispatching' AND claimed_at < now() - interval '10 minutes';
  FOR event IN SELECT candidate.* FROM savings_notifications.events candidate
    WHERE candidate.push_expanded_at IS NULL AND (candidate.push_last_attempt_at IS NULL
      OR candidate.push_last_attempt_at < now() - interval '15 minutes')
      AND (candidate.created_at < now() - interval '7 days'
      OR NOT savings_notifications.push_allowed(candidate, false) OR savings_notifications.push_allowed(candidate, true))
    ORDER BY candidate.created_at, candidate.id LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
    UPDATE savings_notifications.events SET push_last_attempt_at = now() WHERE id = event.id;
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
    WHERE queued.status = 'pending'
      AND (queued.retry_after IS NULL OR queued.retry_after <= now())
      AND (NOT savings_notifications.push_allowed(source_event, false)
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
    UPDATE savings_notifications.deliveries SET status = 'dispatching', claim_id = claim, claimed_at = now(), retry_after = NULL
      WHERE deliveries.notification_id = delivery.notification_id AND deliveries.push_token = delivery.push_token;
    RETURN QUERY SELECT event.id, claim, delivery.push_token::text, event.title, event.body,
      jsonb_build_object('type','savings','goalId',event.goal_id,'notificationId',event.id,'merchantId',event.merchant_id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION savings_notifications.finish_push(p_notification_id uuid, p_push_token text, p_claim_id uuid,
  p_outcome text, p_ticket_id text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_attempts integer;
DECLARE v_event savings_notifications.events%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('accepted','rejected','unregistered','unknown','retryable') OR p_outcome IS NULL OR p_claim_id IS NULL
    OR (p_outcome = 'accepted' AND (p_ticket_id IS NULL OR length(p_ticket_id) NOT BETWEEN 1 AND 256)) THEN
    RAISE EXCEPTION 'Invalid push outcome' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'retryable' THEN
    SELECT delivery.attempts INTO v_attempts FROM savings_notifications.deliveries delivery
      WHERE notification_id = p_notification_id AND push_token = p_push_token AND claim_id = p_claim_id AND status = 'dispatching';
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_attempts >= 96 THEN
      UPDATE savings_notifications.deliveries SET status = 'rejected', ticket_id = NULL, retry_after = NULL
        WHERE notification_id = p_notification_id AND push_token = p_push_token AND claim_id = p_claim_id AND status = 'dispatching';
    ELSE
      UPDATE savings_notifications.deliveries SET status = 'pending', claim_id = NULL, claimed_at = NULL, ticket_id = NULL,
          attempts = attempts + 1, retry_after = now() + interval '15 minutes'
        WHERE notification_id = p_notification_id AND push_token = p_push_token AND claim_id = p_claim_id AND status = 'dispatching';
    END IF;
    RETURN FOUND;
  END IF;
  IF p_outcome = 'unregistered' THEN
    UPDATE savings_notifications.deliveries SET status = 'rejected', ticket_id = NULL, retry_after = NULL
      WHERE notification_id = p_notification_id AND push_token = p_push_token AND claim_id = p_claim_id AND status = 'dispatching';
    IF NOT FOUND THEN RETURN false; END IF;
    SELECT * INTO v_event FROM savings_notifications.events WHERE id = p_notification_id;
    IF FOUND THEN
      UPDATE public.push_tokens token SET is_active = false
        FROM public.customers customer WHERE customer.id = v_event.customer_id AND customer.merchant_id = v_event.merchant_id
          AND token.user_id = customer.user_id AND token.merchant_id = v_event.merchant_id
          AND token.token = p_push_token AND token.app_type = 'storefront';
    END IF;
    RETURN true;
  END IF;
  UPDATE savings_notifications.deliveries SET status = p_outcome, ticket_id = p_ticket_id, retry_after = NULL
    WHERE notification_id = p_notification_id AND push_token = p_push_token AND claim_id = p_claim_id AND status = 'dispatching';
  RETURN FOUND;
END $$;
GRANT EXECUTE ON FUNCTION savings_notifications.finish_push(uuid,text,uuid,text,text) TO baci_savings_notifications_worker;

CREATE OR REPLACE FUNCTION savings_notifications.requeue_delivery(p_ticket_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE delivery savings_notifications.deliveries%ROWTYPE;
BEGIN
  IF p_ticket_id IS NULL THEN RAISE EXCEPTION 'Invalid requeue ticket' USING ERRCODE = '22023'; END IF;
  SELECT * INTO delivery FROM savings_notifications.deliveries WHERE ticket_id = p_ticket_id AND status = 'accepted' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF delivery.attempts >= 96 THEN
    UPDATE savings_notifications.deliveries SET status = 'receipt_unknown', receipt_error = 'MessageRateExceeded', retry_after = NULL
      WHERE notification_id = delivery.notification_id AND push_token = delivery.push_token;
  ELSE
    -- A receipt-phase requeue is a fresh send signal: clear any backoff
    -- stamp so the pinned immediate resend still holds.
    UPDATE savings_notifications.deliveries SET status = 'pending', claim_id = NULL, claimed_at = NULL,
      ticket_id = NULL, receipt_error = 'MessageRateExceeded', attempts = attempts + 1, retry_after = NULL
      WHERE notification_id = delivery.notification_id AND push_token = delivery.push_token;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION savings_notifications.requeue_delivery(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION savings_notifications.requeue_delivery(text) TO baci_savings_notifications_worker;
COMMIT;

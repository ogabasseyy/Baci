BEGIN;
-- Expo rate limits (429) and outages (5xx) are transient: discarding those
-- deliveries as rejected loses notifications a later run could deliver.
-- finish_push gains a retryable outcome that re-queues the delivery as
-- pending (the 15-minute cron is the backoff). Attempts are capped at 96
-- (~24h, matching the receipt staleness horizon); beyond that the delivery
-- dead-letters as rejected instead of retrying forever.
ALTER TABLE savings_notifications.deliveries
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION savings_notifications.finish_push(p_notification_id uuid, p_push_token text, p_claim_id uuid,
  p_outcome text, p_ticket_id text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_attempts integer;
BEGIN
  IF p_outcome NOT IN ('accepted','rejected','unknown','retryable') OR p_outcome IS NULL OR p_claim_id IS NULL
    OR (p_outcome = 'accepted' AND (p_ticket_id IS NULL OR length(p_ticket_id) NOT BETWEEN 1 AND 256)) THEN
    RAISE EXCEPTION 'Invalid push outcome' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'retryable' THEN
    SELECT delivery.attempts INTO v_attempts FROM savings_notifications.deliveries delivery
      WHERE notification_id = p_notification_id AND push_token = p_push_token AND claim_id = p_claim_id AND status = 'dispatching';
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_attempts >= 96 THEN
      UPDATE savings_notifications.deliveries SET status = 'rejected', ticket_id = NULL
        WHERE notification_id = p_notification_id AND push_token = p_push_token AND claim_id = p_claim_id AND status = 'dispatching';
    ELSE
      UPDATE savings_notifications.deliveries SET status = 'pending', claim_id = NULL, claimed_at = NULL, ticket_id = NULL, attempts = attempts + 1
        WHERE notification_id = p_notification_id AND push_token = p_push_token AND claim_id = p_claim_id AND status = 'dispatching';
    END IF;
    RETURN FOUND;
  END IF;
  UPDATE savings_notifications.deliveries SET status = p_outcome, ticket_id = p_ticket_id
    WHERE notification_id = p_notification_id AND push_token = p_push_token AND claim_id = p_claim_id AND status = 'dispatching';
  RETURN FOUND;
END $$;
GRANT EXECUTE ON FUNCTION savings_notifications.finish_push(uuid,text,uuid,text,text) TO baci_savings_notifications_worker;
COMMIT;

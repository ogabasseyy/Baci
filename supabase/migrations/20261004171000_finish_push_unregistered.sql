BEGIN;
-- A ticket-level DeviceNotRegistered error is definitive: Expo returns no
-- receipt id, so the receipt path can never retire the token, and the
-- active token is reselected for every future event. finish_push gains an
-- unregistered outcome that records the delivery as rejected AND
-- deactivates the token, using the exact predicate from record_receipt's
-- DeviceNotRegistered path.
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
      UPDATE savings_notifications.deliveries SET status = 'rejected', ticket_id = NULL
        WHERE notification_id = p_notification_id AND push_token = p_push_token AND claim_id = p_claim_id AND status = 'dispatching';
    ELSE
      UPDATE savings_notifications.deliveries SET status = 'pending', claim_id = NULL, claimed_at = NULL, ticket_id = NULL, attempts = attempts + 1
        WHERE notification_id = p_notification_id AND push_token = p_push_token AND claim_id = p_claim_id AND status = 'dispatching';
    END IF;
    RETURN FOUND;
  END IF;
  IF p_outcome = 'unregistered' THEN
    UPDATE savings_notifications.deliveries SET status = 'rejected', ticket_id = NULL
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
  UPDATE savings_notifications.deliveries SET status = p_outcome, ticket_id = p_ticket_id
    WHERE notification_id = p_notification_id AND push_token = p_push_token AND claim_id = p_claim_id AND status = 'dispatching';
  RETURN FOUND;
END $$;
GRANT EXECUTE ON FUNCTION savings_notifications.finish_push(uuid,text,uuid,text,text) TO baci_savings_notifications_worker;
COMMIT;

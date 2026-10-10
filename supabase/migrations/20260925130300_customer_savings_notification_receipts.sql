BEGIN;
ALTER TABLE savings_notifications.deliveries DROP CONSTRAINT deliveries_status_check;
ALTER TABLE savings_notifications.deliveries ADD CONSTRAINT deliveries_status_check
  CHECK (status IN ('pending','dispatching','accepted','rejected','unknown','suppressed','provider_confirmed','receipt_failed','receipt_unknown'));
ALTER TABLE savings_notifications.deliveries ADD COLUMN IF NOT EXISTS receipt_error text;

CREATE FUNCTION savings_notifications.pending_receipts(p_limit integer DEFAULT 100)
RETURNS TABLE(ticket_id text, notification_id uuid, push_token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'Invalid receipt limit' USING ERRCODE = '22023'; END IF;
  UPDATE savings_notifications.deliveries SET status = 'receipt_unknown'
    WHERE status = 'accepted' AND claimed_at < now() - interval '24 hours';
  RETURN QUERY SELECT delivery.ticket_id, delivery.notification_id, delivery.push_token FROM savings_notifications.deliveries delivery
    WHERE delivery.status = 'accepted' AND delivery.ticket_id IS NOT NULL AND delivery.claimed_at <= now() - interval '15 minutes'
    ORDER BY delivery.claimed_at LIMIT p_limit;
END $$;

CREATE FUNCTION savings_notifications.record_receipt(p_ticket_id text, p_status text, p_error text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE delivery savings_notifications.deliveries%ROWTYPE; event savings_notifications.events%ROWTYPE;
BEGIN
  IF p_ticket_id IS NULL OR p_status IS NULL OR p_status NOT IN ('provider_confirmed','receipt_failed')
    OR (p_error IS NOT NULL AND p_error NOT IN ('DeviceNotRegistered','MessageTooBig','MessageRateExceeded','MismatchSenderId','InvalidCredentials','UnknownError')) THEN
    RAISE EXCEPTION 'Invalid receipt result' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO delivery FROM savings_notifications.deliveries WHERE ticket_id = p_ticket_id AND status = 'accepted' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE savings_notifications.deliveries SET status = p_status, receipt_error = p_error
    WHERE notification_id = delivery.notification_id AND push_token = delivery.push_token;
  IF p_status = 'receipt_failed' AND p_error = 'DeviceNotRegistered' THEN
    SELECT * INTO STRICT event FROM savings_notifications.events WHERE id = delivery.notification_id;
    UPDATE public.push_tokens token SET is_active = false
      FROM public.customers customer WHERE customer.id = event.customer_id AND customer.merchant_id = event.merchant_id
        AND token.user_id = customer.user_id AND token.merchant_id = event.merchant_id
        AND token.token = delivery.push_token AND token.app_type = 'storefront';
  END IF;
  RETURN true;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS savings_notification_delivery_ticket_idx ON savings_notifications.deliveries(ticket_id) WHERE ticket_id IS NOT NULL;
REVOKE ALL ON FUNCTION savings_notifications.pending_receipts(integer), savings_notifications.record_receipt(text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION savings_notifications.pending_receipts(integer), savings_notifications.record_receipt(text,text,text) TO baci_savings_notifications_worker;
COMMIT;

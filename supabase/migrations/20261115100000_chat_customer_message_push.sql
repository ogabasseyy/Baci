-- Mobile push for customer chat notifications, without a service-role client.
--
-- After record_chat_customer_message reports "notified", the chat webhook may
-- push to the store's merchant-app devices. It has no user session, so every
-- database step goes through a narrow SECURITY DEFINER function that needs
-- (a) a short-lived HMAC proof made from the same server-only secret and
-- (b) a one-time claim on that exact notified event. The store, the app type
-- and the eligible users are derived here, never taken from the caller, in
-- the same way the tracking worker's lease-bound push wrappers do it.
BEGIN;

ALTER TABLE public.chat_message_events
  ADD COLUMN IF NOT EXISTS push_claim uuid,
  ADD COLUMN IF NOT EXISTS push_claimed_at timestamptz;

-- Verifies a push proof and returns the store only while the caller holds the
-- live claim for that notified event. NULL means "no authority": every
-- wrapper below then does nothing.
CREATE OR REPLACE FUNCTION private.chat_event_push_lease(
  p_proof text,
  p_issued_at bigint,
  p_merchant_id uuid,
  p_event_key text,
  p_claim uuid,
  p_action text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_canonical text;
  v_secret text;
  v_valid boolean := false;
BEGIN
  IF p_proof IS NULL OR p_proof !~ '^[0-9a-f]{64}$'
    OR p_issued_at IS NULL OR p_merchant_id IS NULL OR p_claim IS NULL
    OR p_event_key IS NULL OR p_event_key !~ '^[A-Za-z0-9_-]{8,80}$'
    OR p_action IS NULL OR p_action !~ '^[a-z_]{3,32}$' THEN
    RAISE EXCEPTION 'invalid_chat_push_request' USING ERRCODE = '22023';
  END IF;
  IF extract(epoch FROM pg_catalog.now()) - p_issued_at > 300
    OR p_issued_at - extract(epoch FROM pg_catalog.now()) > 60 THEN
    RAISE EXCEPTION 'chat_event_proof_expired' USING ERRCODE = '42501';
  END IF;
  v_canonical := pg_catalog.concat_ws(
    '|', 'chat-event-push:v1', p_issued_at::text, p_merchant_id::text,
    p_event_key, p_claim::text, p_action
  );
  IF NOT EXISTS (SELECT 1 FROM private.chat_event_server_secrets) THEN
    RAISE EXCEPTION 'chat_event_secret_not_configured' USING ERRCODE = '55000';
  END IF;
  FOR v_secret IN SELECT secret FROM private.chat_event_server_secrets LOOP
    IF extensions.digest(pg_catalog.encode(extensions.hmac(v_canonical, v_secret, 'sha256'), 'hex'), 'sha256')
      = extensions.digest(p_proof, 'sha256') THEN
      v_valid := true;
    END IF;
  END LOOP;
  IF NOT v_valid THEN
    RAISE EXCEPTION 'chat_event_proof_invalid' USING ERRCODE = '42501';
  END IF;

  -- The claim is only live for ten minutes after it was taken.
  RETURN (
    SELECT e.merchant_id FROM public.chat_message_events e
    WHERE e.merchant_id = p_merchant_id
      AND e.event_key = p_event_key
      AND e.outcome = 'notified'
      AND e.push_claim = p_claim
      AND e.push_claimed_at > pg_catalog.now() - interval '10 minutes'
  );
END;
$$;
REVOKE ALL ON FUNCTION private.chat_event_push_lease(text, bigint, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- Users whose merchant-app devices may be told about a customer chat: the
-- owner, and active staff allowed to view customers (the inbox permission).
-- check_staff_permission only answers for the calling user or the service
-- role, and this runs for a caller with no session, so the role claim is
-- raised for the lookup and restored straight after, exactly as the tracking
-- worker's recipient lookup does.
CREATE OR REPLACE FUNCTION private.chat_event_push_recipients(p_merchant_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_previous_role text;
  v_users uuid[];
BEGIN
  v_previous_role := pg_catalog.current_setting('request.jwt.claim.role', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  SELECT COALESCE(pg_catalog.array_agg(member.user_id), '{}'::uuid[])
  INTO v_users
  FROM (
    SELECT m.user_id FROM public.merchants m WHERE m.id = p_merchant_id
    UNION
    SELECT staff.user_id FROM public.staff_members staff
    WHERE staff.merchant_id = p_merchant_id
      AND staff.status = 'active'
      AND public.check_staff_permission(staff.user_id, staff.merchant_id, 'customers', 'view')
  ) AS member
  WHERE member.user_id IS NOT NULL;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), true);
  RETURN v_users;
END;
$$;
REVOKE ALL ON FUNCTION private.chat_event_push_recipients(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 1. Take the one-time push claim for a notified event. False when the event
-- was not notified or a push was already claimed for it, so a redelivered
-- webhook can never push twice.
CREATE OR REPLACE FUNCTION public.chat_event_claim_push(
  p_proof text, p_issued_at bigint, p_merchant_id uuid, p_event_key text, p_claim uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_claimed integer;
BEGIN
  -- The proof is checked against the claim the caller wants to take; the
  -- lease lookup is expected to find nothing yet.
  PERFORM private.chat_event_push_lease(p_proof, p_issued_at, p_merchant_id, p_event_key, p_claim, 'claim');
  UPDATE public.chat_message_events e
  SET push_claim = p_claim, push_claimed_at = pg_catalog.now()
  WHERE e.merchant_id = p_merchant_id AND e.event_key = p_event_key
    AND e.outcome = 'notified' AND e.push_claim IS NULL;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed = 1;
END;
$$;

-- 2. Active merchant-app tokens of the claimed event's store.
CREATE OR REPLACE FUNCTION public.chat_event_push_tokens(
  p_proof text, p_issued_at bigint, p_merchant_id uuid, p_event_key text, p_claim uuid
) RETURNS TABLE (token text, platform text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_merchant uuid;
  v_recipients uuid[];
BEGIN
  v_merchant := private.chat_event_push_lease(p_proof, p_issued_at, p_merchant_id, p_event_key, p_claim, 'tokens');
  IF v_merchant IS NULL THEN RETURN; END IF;
  v_recipients := private.chat_event_push_recipients(v_merchant);
  RETURN QUERY
  SELECT pt.token, pt.platform
  FROM public.push_tokens pt
  WHERE pt.merchant_id = v_merchant
    AND pt.is_active = true
    AND pt.app_type = 'admin'
    AND pt.user_id = ANY (v_recipients)
  LIMIT 500;
END;
$$;

-- 3. Store accepted tickets for receipt polling; only this store's
-- merchant-app tokens are accepted.
CREATE OR REPLACE FUNCTION public.chat_event_store_push_tickets(
  p_proof text, p_issued_at bigint, p_merchant_id uuid, p_event_key text, p_claim uuid, p_tickets jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_merchant uuid;
BEGIN
  v_merchant := private.chat_event_push_lease(p_proof, p_issued_at, p_merchant_id, p_event_key, p_claim, 'tickets');
  IF v_merchant IS NULL THEN RETURN false; END IF;
  IF p_tickets IS NULL OR pg_catalog.jsonb_typeof(p_tickets) IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(p_tickets) > 1000 THEN
    RAISE EXCEPTION 'invalid_chat_push_request' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.push_notification_tickets (
    ticket_id, push_token, merchant_id, user_id, app_type, channel, notification_type, status
  )
  SELECT pg_catalog.left(ticket ->> 'ticket_id', 256), ticket ->> 'push_token',
    v_merchant, NULL, 'admin', 'general', 'customer_message', 'pending'
  FROM pg_catalog.jsonb_array_elements(p_tickets) AS ticket
  WHERE NULLIF(ticket ->> 'ticket_id', '') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.push_tokens pt
      WHERE pt.token = ticket ->> 'push_token'
        AND pt.merchant_id = v_merchant AND pt.app_type = 'admin'
    )
  -- Storing the same tickets again (a retried step) is a no-op.
  ON CONFLICT (ticket_id) DO NOTHING;
  RETURN true;
END;
$$;

-- 4. Deactivate undeliverable tokens, only this store's merchant-app tokens.
CREATE OR REPLACE FUNCTION public.chat_event_deactivate_push_tokens(
  p_proof text, p_issued_at bigint, p_merchant_id uuid, p_event_key text, p_claim uuid,
  p_reason text, p_tokens text[]
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_merchant uuid;
BEGIN
  v_merchant := private.chat_event_push_lease(p_proof, p_issued_at, p_merchant_id, p_event_key, p_claim, 'deactivate');
  IF v_merchant IS NULL THEN RETURN false; END IF;
  IF NULLIF(pg_catalog.btrim(p_reason), '') IS NULL OR char_length(p_reason) > 64
    OR p_tokens IS NULL OR pg_catalog.cardinality(p_tokens) > 1000 THEN
    RAISE EXCEPTION 'invalid_chat_push_request' USING ERRCODE = '22023';
  END IF;
  UPDATE public.push_tokens pt
  SET is_active = false, deactivation_reason = p_reason, deactivated_at = pg_catalog.now()
  WHERE pt.token = ANY (p_tokens) AND pt.merchant_id = v_merchant AND pt.app_type = 'admin';
  RETURN true;
END;
$$;

-- 5. Record the delivery attempt. The stored title and body are fixed here:
-- customer text is never copied into the push log.
CREATE OR REPLACE FUNCTION public.chat_event_record_push_attempt(
  p_proof text, p_issued_at bigint, p_merchant_id uuid, p_event_key text, p_claim uuid, p_attempt jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_merchant uuid;
BEGIN
  v_merchant := private.chat_event_push_lease(p_proof, p_issued_at, p_merchant_id, p_event_key, p_claim, 'attempt');
  IF v_merchant IS NULL THEN RETURN false; END IF;
  IF p_attempt IS NULL OR pg_catalog.jsonb_typeof(p_attempt) IS DISTINCT FROM 'object'
    OR (p_attempt ->> 'status') IS NULL
    OR (p_attempt ->> 'status') NOT IN ('sent', 'partial_failure', 'failed', 'skipped_no_tokens')
    -- Counts must be small non-negative whole numbers before they are cast.
    OR COALESCE(p_attempt ->> 'token_count', '0') !~ '^[0-9]{1,6}$'
    OR COALESCE(p_attempt ->> 'sent_count', '0') !~ '^[0-9]{1,6}$'
    OR COALESCE(p_attempt ->> 'failed_count', '0') !~ '^[0-9]{1,6}$' THEN
    RAISE EXCEPTION 'invalid_chat_push_request' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.push_notification_attempts (
    merchant_id, user_id, app_type, channel, notification_type, title, body,
    payload, token_count, sent_count, failed_count, status, errors
  ) VALUES (
    v_merchant, NULL, 'admin', 'general', 'customer_message',
    'New customer message', 'A customer sent a message to your store.',
    pg_catalog.jsonb_build_object('type', 'customer_message', 'event_key', p_event_key),
    GREATEST(COALESCE((p_attempt ->> 'token_count')::integer, 0), 0),
    GREATEST(COALESCE((p_attempt ->> 'sent_count')::integer, 0), 0),
    GREATEST(COALESCE((p_attempt ->> 'failed_count')::integer, 0), 0),
    p_attempt ->> 'status',
    CASE WHEN pg_catalog.jsonb_typeof(p_attempt -> 'errors') = 'array'
      THEN p_attempt -> 'errors' ELSE '[]'::jsonb END
  );
  RETURN true;
END;
$$;

-- Reachable without a session, but useless without a valid proof and claim.
REVOKE ALL ON FUNCTION public.chat_event_claim_push(text, bigint, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_event_claim_push(text, bigint, uuid, text, uuid) TO anon, service_role;
REVOKE ALL ON FUNCTION public.chat_event_push_tokens(text, bigint, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_event_push_tokens(text, bigint, uuid, text, uuid) TO anon, service_role;
REVOKE ALL ON FUNCTION public.chat_event_store_push_tickets(text, bigint, uuid, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_event_store_push_tickets(text, bigint, uuid, text, uuid, jsonb) TO anon, service_role;
REVOKE ALL ON FUNCTION public.chat_event_deactivate_push_tokens(text, bigint, uuid, text, uuid, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_event_deactivate_push_tokens(text, bigint, uuid, text, uuid, text, text[]) TO anon, service_role;
REVOKE ALL ON FUNCTION public.chat_event_record_push_attempt(text, bigint, uuid, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_event_record_push_attempt(text, bigint, uuid, text, uuid, jsonb) TO anon, service_role;

COMMIT;

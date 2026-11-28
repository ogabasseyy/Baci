-- Follow-up reminder sweep functions (part 2 of 4; the table and its row-level
-- security are in 20261124120000_chat_follow_up_reminders.sql).
--
-- Two narrow SECURITY DEFINER functions for the cron sweep, which has no user
-- session: each needs a short-lived HMAC proof made from the same server-only
-- secret as record_chat_handover, with its own proof label so no proof can be
-- replayed as another kind. A shared private helper verifies the proof.
BEGIN;

-- New in this migration (nothing earlier defines it, so no existing message or
-- handover proof path changes). Verifies one server HMAC proof against the canonical text. Raises when the
-- proof is stale, forged or the secret is not provisioned; returns when valid.
CREATE OR REPLACE FUNCTION private.chat_event_require_proof(
  p_canonical text,
  p_proof text,
  p_issued_at bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_secret text;
  v_valid boolean := false;
BEGIN
  IF p_proof IS NULL OR p_proof !~ '^[0-9a-f]{64}$' OR p_issued_at IS NULL THEN
    RAISE EXCEPTION 'invalid_chat_event' USING ERRCODE = '22023';
  END IF;
  -- A proof is good for five minutes, with one minute allowed for a server
  -- clock running ahead of the database.
  IF extract(epoch FROM pg_catalog.now()) - p_issued_at > 300
    OR p_issued_at - extract(epoch FROM pg_catalog.now()) > 60 THEN
    RAISE EXCEPTION 'chat_event_proof_expired' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.chat_event_server_secrets) THEN
    RAISE EXCEPTION 'chat_event_secret_not_configured' USING ERRCODE = '55000';
  END IF;
  FOR v_secret IN SELECT secret FROM private.chat_event_server_secrets LOOP
    IF extensions.digest(pg_catalog.encode(extensions.hmac(p_canonical, v_secret, 'sha256'), 'hex'), 'sha256')
      = extensions.digest(p_proof, 'sha256') THEN
      v_valid := true;
    END IF;
  END LOOP;
  IF NOT v_valid THEN
    RAISE EXCEPTION 'chat_event_proof_invalid' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.chat_event_require_proof(text, text, bigint) FROM PUBLIC, anon, authenticated, service_role;

-- Puts a taken reminder back so a later sweep can push it, at most three takes
-- in all and only inside the 24-hour window. The push event is removed first,
-- and only if sending was never marked as begun: the mark is written before
-- anything is handed to the delivery provider, so nothing can have left the
-- server, and a run marking it late finds no event and sends nothing. A marked
-- push is never put back, whoever asks. A muted or stale reminder has no
-- notified event and is never put back either. Only the take being given up
-- (its number) is put back: every take reuses the event key, so a late caller
-- must not remove a newer take's event. updated_at is left as the last take: it
-- spaces the retries.
CREATE OR REPLACE FUNCTION private.requeue_chat_follow_up_reminder(
  p_merchant_id uuid,
  p_reminder_id uuid,
  p_take integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.chat_follow_up_reminders r
  WHERE r.id = p_reminder_id AND r.merchant_id = p_merchant_id
    AND r.processed_at IS NOT NULL AND r.attempts = p_take AND r.attempts < 3
    AND r.due_at > pg_catalog.now() - interval '24 hours'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  DELETE FROM public.chat_message_events e
  WHERE e.merchant_id = p_merchant_id
    AND e.event_key = 'fu-' || pg_catalog.replace(p_reminder_id::text, '-', '')
    AND e.kind = 'follow_up' AND e.outcome = 'notified'
    AND e.push_dispatch_started_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.chat_follow_up_reminders r
  SET processed_at = NULL
  WHERE r.id = p_reminder_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION private.requeue_chat_follow_up_reminder(uuid, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

-- 1. The reminders that came due in the last 24 hours and nobody handled yet,
-- never-listed first, then oldest. A reminder older than a day is never listed,
-- so switching the feature on (or an outage) never replays a pile of old
-- follow-ups. Listing stamps last_listed_at and does a bounded cleanup of rows
-- a week old.
CREATE OR REPLACE FUNCTION public.list_due_chat_follow_up_reminders(
  p_proof text,
  p_issued_at bigint,
  p_limit integer
) RETURNS TABLE (
  reminder_id uuid,
  merchant_id uuid,
  conversation_id bigint,
  due_at timestamptz,
  customer_name text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'invalid_chat_event' USING ERRCODE = '22023';
  END IF;
  PERFORM private.chat_event_require_proof(
    pg_catalog.concat_ws('|', 'chat-follow-up-list:v1', p_issued_at::text, p_limit::text),
    p_proof, p_issued_at
  );

  DELETE FROM public.chat_follow_up_reminders r
  WHERE r.id IN (
    SELECT old.id FROM public.chat_follow_up_reminders old
    WHERE old.due_at < pg_catalog.now() - interval '7 days'
    LIMIT 200
  );

  -- A run stopped between taking a reminder and starting to send sent
  -- nothing: after ten minutes (far longer than a run lasts) it is put back,
  -- but not while its push claim is still live (ten minutes from the claim).
  PERFORM private.requeue_chat_follow_up_reminder(lost.merchant_id, lost.id, lost.attempts)
  FROM (
    SELECT r.merchant_id, r.id, r.attempts
    FROM public.chat_follow_up_reminders r
    JOIN public.chat_message_events e
      ON e.merchant_id = r.merchant_id
      AND e.event_key = 'fu-' || pg_catalog.replace(r.id::text, '-', '')
    WHERE r.processed_at < pg_catalog.now() - interval '10 minutes'
      AND r.attempts < 3
      AND r.due_at > pg_catalog.now() - interval '24 hours'
      AND e.kind = 'follow_up' AND e.outcome = 'notified' AND e.push_dispatch_started_at IS NULL
      AND (e.push_claim IS NULL OR e.push_claimed_at <= pg_catalog.now() - interval '10 minutes')
    LIMIT 50
  ) lost;

  -- Reminders not listed before come first, then the ones listed longest ago,
  -- so a reminder the sweep cannot act on moves to the back after each look
  -- instead of holding the front of the line. Rows another sweep is reading
  -- right now are skipped.
  RETURN QUERY
  WITH picked AS (
    SELECT r.id
    FROM public.chat_follow_up_reminders r
    WHERE r.processed_at IS NULL
      AND r.due_at <= pg_catalog.now()
      AND r.due_at > pg_catalog.now() - interval '24 hours'
      -- A retry waits ten minutes after the first take and two hours after the
      -- second, so a phone registered later in the day still gets the reminder.
      AND (r.attempts = 0 OR r.updated_at <= pg_catalog.now()
        - CASE WHEN r.attempts = 1 THEN interval '10 minutes' ELSE interval '2 hours' END)
    ORDER BY r.last_listed_at NULLS FIRST, r.due_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), stamped AS (
    UPDATE public.chat_follow_up_reminders u
    SET last_listed_at = pg_catalog.now()
    FROM picked
    WHERE u.id = picked.id
    RETURNING u.id, u.merchant_id, u.conversation_id, u.due_at, u.customer_name
  )
  SELECT s.id, s.merchant_id, s.conversation_id, s.due_at, s.customer_name
  FROM stamped s
  ORDER BY s.due_at;
END;
$$;

-- 2. Takes one reminder, exactly once, and records the push event for it.
-- p_send = false consumes a reminder the server found stale (the chat was
-- finished or its follow-up changed outside the app). The answer is:
--   notified: the event row exists and may be pushed (claim it with the push
--             wrappers); "take" numbers this take, for a later put back,
--   muted: the store turned chat alerts off,
--   ignored:  not due, already handled, replaced or removed, or not to be sent.
-- The reminder is only taken while it is due and inside the 24-hour window,
-- and only under the exact id the sweep listed, so a follow-up that was
-- replaced or cleared in the meantime is ignored. Unlike an ordinary message,
-- a reminder is the team's own request, so it is NOT muted by the "handover
-- only" level; only "off" silences it.
CREATE OR REPLACE FUNCTION public.record_chat_follow_up_reminder(
  p_proof text,
  p_issued_at bigint,
  p_merchant_id uuid,
  p_reminder_id uuid,
  p_send boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.chat_follow_up_reminders;
  v_level text;
  v_outcome text;
BEGIN
  IF p_merchant_id IS NULL OR p_reminder_id IS NULL OR p_send IS NULL THEN
    RAISE EXCEPTION 'invalid_chat_event' USING ERRCODE = '22023';
  END IF;
  PERFORM private.chat_event_require_proof(
    pg_catalog.concat_ws(
      '|', 'chat-follow-up:v1', p_issued_at::text, p_merchant_id::text,
      p_reminder_id::text, p_send::text
    ),
    p_proof, p_issued_at
  );

  -- Same per-store lock as the other chat intakes.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chat-events:' || p_merchant_id::text, 0)
  );

  -- The single atomic take: only one caller can ever win a given reminder id.
  UPDATE public.chat_follow_up_reminders r
  SET processed_at = pg_catalog.now(), updated_at = pg_catalog.now(), attempts = r.attempts + 1
  WHERE r.id = p_reminder_id
    AND r.merchant_id = p_merchant_id
    AND r.processed_at IS NULL
    AND r.due_at <= pg_catalog.now()
    AND r.due_at > pg_catalog.now() - interval '24 hours'
    -- The retry spacing of the list, held here too: a sweep that listed before
    -- another one's put back must not use up the next take at once.
    AND (r.attempts = 0 OR r.updated_at <= pg_catalog.now()
      - CASE WHEN r.attempts = 1 THEN interval '10 minutes' ELSE interval '2 hours' END)
  RETURNING r.* INTO v_row;
  IF NOT FOUND OR NOT p_send THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'ignored');
  END IF;

  -- No preference row, or an unreadable level, means the default: alert.
  SELECT COALESCE(p.chat_message_notifications, 'all') INTO v_level
    FROM public.notification_preferences p WHERE p.merchant_id = p_merchant_id;
  v_outcome := CASE WHEN COALESCE(v_level, 'all') = 'off' THEN 'muted' ELSE 'notified' END;

  -- No bell notification: this is a phone reminder only. The event row is what
  -- the push claim works from.
  INSERT INTO public.chat_message_events(event_key, merchant_id, conversation_id, outcome, kind)
  VALUES (
    'fu-' || pg_catalog.replace(v_row.id::text, '-', ''),
    p_merchant_id, v_row.conversation_id, v_outcome, 'follow_up'
  );

  -- The same bounded housekeeping as the message and handover intakes, so a
  -- store that only uses follow-ups does not keep events for ever.
  DELETE FROM public.chat_message_events
  WHERE merchant_id = p_merchant_id AND event_key IN (
    SELECT event_key FROM public.chat_message_events
    WHERE merchant_id = p_merchant_id AND created_at < pg_catalog.now() - interval '30 days'
    LIMIT 200
  );

  IF v_outcome = 'notified' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', v_outcome, 'take', v_row.attempts);
  END IF;
  RETURN pg_catalog.jsonb_build_object('outcome', v_outcome);
END;
$$;

COMMENT ON FUNCTION public.list_due_chat_follow_up_reminders(text, bigint, integer) IS
  'Cron sweep: verifies a server HMAC proof, then lists follow-up reminders that came due in the last 24 hours.';
COMMENT ON FUNCTION public.record_chat_follow_up_reminder(text, bigint, uuid, uuid, boolean) IS
  'Cron sweep: verifies a server HMAC proof, then takes one due follow-up reminder exactly once and records its push event.';

-- Reachable without a session, but useless without a valid proof.
REVOKE ALL ON FUNCTION public.list_due_chat_follow_up_reminders(text, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_due_chat_follow_up_reminders(text, bigint, integer) TO anon, service_role;
REVOKE ALL ON FUNCTION public.record_chat_follow_up_reminder(text, bigint, uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_chat_follow_up_reminder(text, bigint, uuid, uuid, boolean) TO anon, service_role;

COMMIT;

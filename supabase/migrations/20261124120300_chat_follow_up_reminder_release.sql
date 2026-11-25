-- Follow-up reminder retry (part 4 of 4). The sweep takes a reminder before pushing it, so a
-- push that failed would otherwise be lost. When the server KNOWS the push
-- never reached the delivery provider, it puts the reminder back for the next
-- sweep (same proof model and secret as the other sweep functions, its own
-- label). A push that may have left is never put back: never twice. The second
-- function records that sending began, which is how a run that stopped before
-- that point is told apart.
BEGIN;

CREATE OR REPLACE FUNCTION public.release_chat_follow_up_reminder(
  p_proof text,
  p_issued_at bigint,
  p_merchant_id uuid,
  p_reminder_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_merchant_id IS NULL OR p_reminder_id IS NULL THEN
    RAISE EXCEPTION 'invalid_chat_event' USING ERRCODE = '22023';
  END IF;
  PERFORM private.chat_event_require_proof(
    pg_catalog.concat_ws(
      '|', 'chat-follow-up-release:v1', p_issued_at::text, p_merchant_id::text,
      p_reminder_id::text
    ),
    p_proof, p_issued_at
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chat-events:' || p_merchant_id::text, 0)
  );
  -- Already put back (by the list's own recovery): the retry stands.
  IF EXISTS (
    SELECT 1 FROM public.chat_follow_up_reminders r
    WHERE r.id = p_reminder_id AND r.merchant_id = p_merchant_id
      AND r.processed_at IS NULL AND r.attempts > 0
  ) THEN
    RETURN true;
  END IF;
  RETURN private.requeue_chat_follow_up_reminder(p_merchant_id, p_reminder_id);
END;
$$;

COMMENT ON FUNCTION public.release_chat_follow_up_reminder(text, bigint, uuid, uuid) IS
  'Cron sweep: verifies a server HMAC proof, then puts back a follow-up reminder whose push never left the server (at most three takes).';

-- Reachable without a session, but useless without a valid proof.
REVOKE ALL ON FUNCTION public.release_chat_follow_up_reminder(text, bigint, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_chat_follow_up_reminder(text, bigint, uuid, uuid) TO anon, service_role;

-- Called by the push claim holder just before the first request to the delivery
-- provider (same proof and live claim as the other push wrappers, action
-- 'dispatch'). False means there is no authority to send, and nothing is sent.
CREATE OR REPLACE FUNCTION public.chat_event_mark_push_dispatch(
  p_proof text,
  p_issued_at bigint,
  p_merchant_id uuid,
  p_event_key text,
  p_claim uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF private.chat_event_push_lease(p_proof, p_issued_at, p_merchant_id, p_event_key, p_claim, 'dispatch') IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.chat_message_events e
  SET push_dispatch_started_at = pg_catalog.now()
  WHERE e.merchant_id = p_merchant_id AND e.event_key = p_event_key AND e.push_claim = p_claim;
  -- False too when a sweep put the reminder back (removing the event) meanwhile.
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.chat_event_mark_push_dispatch(text, bigint, uuid, text, uuid) IS
  'Chat push: verifies the claim-bound HMAC proof, then records that sending of this event is about to begin.';
REVOKE ALL ON FUNCTION public.chat_event_mark_push_dispatch(text, bigint, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_event_mark_push_dispatch(text, bigint, uuid, text, uuid) TO anon, service_role;

COMMIT;

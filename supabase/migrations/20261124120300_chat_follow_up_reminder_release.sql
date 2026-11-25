-- Follow-up reminder retry. The sweep takes a reminder before pushing it, so a
-- push that failed would otherwise be lost. When the server KNOWS the push
-- never reached the delivery provider, it puts the reminder back for the next
-- sweep (same proof model and secret as the other sweep functions, its own
-- label). A push that may have left is never put back: never twice.
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
  RETURN private.requeue_chat_follow_up_reminder(p_merchant_id, p_reminder_id, false);
END;
$$;

COMMENT ON FUNCTION public.release_chat_follow_up_reminder(text, bigint, uuid, uuid) IS
  'Cron sweep: verifies a server HMAC proof, then puts back a follow-up reminder whose push never left the server (at most three takes).';

-- Reachable without a session, but useless without a valid proof.
REVOKE ALL ON FUNCTION public.release_chat_follow_up_reminder(text, bigint, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_chat_follow_up_reminder(text, bigint, uuid, uuid) TO anon, service_role;

COMMIT;

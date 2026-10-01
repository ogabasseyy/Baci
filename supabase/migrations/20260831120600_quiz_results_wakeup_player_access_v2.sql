-- Authorize private result wakeups through a narrow owner projection so a v2
-- player does not need direct SELECT access to the hidden quiz_events row.

BEGIN;

CREATE OR REPLACE FUNCTION public.can_receive_quiz_results_wakeup_v2(
  p_topic text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_topic IS NULL OR p_topic !~
    '^quiz-results:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN
    RETURN false;
  END IF;

  v_event_id := pg_catalog.substring(p_topic, 14)::uuid;
  RETURN EXISTS (
    SELECT 1
    FROM public.quiz_events AS event
    WHERE event.id = v_event_id
      AND (
        public.has_merchant_access(event.merchant_id)
        OR EXISTS (
          SELECT 1
          FROM public.quiz_attempts AS attempt
          JOIN public.customers AS customer
            ON customer.id = attempt.customer_id
          WHERE attempt.event_id = v_event_id
            AND customer.user_id = v_user_id
            AND customer.deleted_at IS NULL
        )
      )
  );
END;
$$;

ALTER FUNCTION public.can_receive_quiz_results_wakeup_v2(text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_receive_quiz_results_wakeup_v2(text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_receive_quiz_results_wakeup_v2(text)
  TO authenticated;

DROP POLICY IF EXISTS "authorized players receive quiz results wakeups"
  ON realtime.messages;
DROP POLICY IF EXISTS "quiz results topics require attempt access"
  ON realtime.messages;
CREATE POLICY "authorized players receive quiz results wakeups"
  ON realtime.messages AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND public.can_receive_quiz_results_wakeup_v2(realtime.topic())
  );
CREATE POLICY "quiz results topics require attempt access"
  ON realtime.messages AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    realtime.topic() !~ '^quiz-results:' OR (
      realtime.messages.extension = 'broadcast'
      AND public.can_receive_quiz_results_wakeup_v2(realtime.topic())
    )
  );

COMMIT;

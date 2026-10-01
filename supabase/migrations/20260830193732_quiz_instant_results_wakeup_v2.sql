-- A result publication emits one private, payload-free wakeup. Authorized
-- players refetch the existing owner-scoped result projection after commit.

BEGIN;

CREATE OR REPLACE FUNCTION private.emit_quiz_results_ready_v2(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_event_id IS NULL OR pg_catalog.to_regprocedure(
    'realtime.send(jsonb,text,text,boolean)'
  ) IS NULL THEN RETURN; END IF;
  PERFORM realtime.send(
    '{}'::jsonb, 'quiz_results_ready',
    'quiz-results:' || p_event_id::text, true
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.broadcast_quiz_results_ready_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.results_published_at IS NULL AND NEW.results_published_at IS NOT NULL THEN
    BEGIN
      PERFORM private.emit_quiz_results_ready_v2(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'QUIZ_RESULTS_BROADCAST_FAILED sqlstate=%', SQLSTATE;
    END;
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION private.emit_quiz_results_ready_v2(uuid) OWNER TO postgres;
ALTER FUNCTION private.broadcast_quiz_results_ready_v2() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.emit_quiz_results_ready_v2(uuid),
  private.broadcast_quiz_results_ready_v2()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS broadcast_quiz_results_ready_v2 ON public.quiz_events;
CREATE TRIGGER broadcast_quiz_results_ready_v2
AFTER UPDATE OF results_published_at ON public.quiz_events
FOR EACH ROW EXECUTE FUNCTION private.broadcast_quiz_results_ready_v2();

DROP POLICY IF EXISTS "authorized players receive quiz results wakeups"
  ON realtime.messages;
DROP POLICY IF EXISTS "quiz results topics require attempt access"
  ON realtime.messages;
DROP POLICY IF EXISTS "quiz results topics reject client sends"
  ON realtime.messages;
CREATE POLICY "authorized players receive quiz results wakeups"
  ON realtime.messages AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND realtime.topic() ~ '^quiz-results:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND EXISTS (
      SELECT 1 FROM public.quiz_events AS event
      WHERE event.id = pg_catalog.substring(realtime.topic(), 14)::uuid
        AND (
          public.has_merchant_access(event.merchant_id)
          OR EXISTS (
            SELECT 1 FROM public.quiz_attempts AS attempt
            JOIN public.customers AS customer ON customer.id = attempt.customer_id
            WHERE attempt.event_id = event.id
              AND customer.user_id = auth.uid()
              AND customer.deleted_at IS NULL
          )
        )
    )
  );
CREATE POLICY "quiz results topics require attempt access"
  ON realtime.messages AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    realtime.topic() !~ '^quiz-results:' OR (
      realtime.messages.extension = 'broadcast'
      AND realtime.topic() ~ '^quiz-results:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM public.quiz_events AS event
        WHERE event.id = pg_catalog.substring(realtime.topic(), 14)::uuid
          AND (
            public.has_merchant_access(event.merchant_id)
            OR EXISTS (
              SELECT 1 FROM public.quiz_attempts AS attempt
              JOIN public.customers AS customer
                ON customer.id = attempt.customer_id
              WHERE attempt.event_id = event.id
                AND customer.user_id = auth.uid()
                AND customer.deleted_at IS NULL
            )
          )
      )
    )
  );
CREATE POLICY "quiz results topics reject client sends"
  ON realtime.messages AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (realtime.topic() !~ '^quiz-results:');

COMMIT;

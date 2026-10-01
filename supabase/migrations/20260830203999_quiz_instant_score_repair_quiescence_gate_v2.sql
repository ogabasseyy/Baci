-- Refuse the one-time serialized score repair while a v2 quiz can accept answers.

BEGIN;

CREATE OR REPLACE FUNCTION private.assert_quiz_score_repair_quiescent_v2()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.quiz_events AS event
    WHERE event.contract_version = 2
      AND (
        event.status = 'active'
        OR (
          event.status = 'scheduled'
          AND event.starts_at <= pg_catalog.clock_timestamp()
        )
      )
      AND event.ends_at > pg_catalog.clock_timestamp()
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'quiz_score_repair_requires_quiescent_v2_events';
  END IF;
END;
$$;

ALTER FUNCTION private.assert_quiz_score_repair_quiescent_v2()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.assert_quiz_score_repair_quiescent_v2()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT private.assert_quiz_score_repair_quiescent_v2();

COMMIT;

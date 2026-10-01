-- Keep database-clock test publication closed until the serialized score
-- repair has completed. This migration intentionally sorts immediately before
-- the first deadline-clock migration so a fresh replay cannot publish a stale
-- aggregate while later score-repair migrations are still pending.

BEGIN;

CREATE TABLE IF NOT EXISTS private.quiz_test_publication_control_v2 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  score_repair_ready boolean NOT NULL DEFAULT false
);

INSERT INTO private.quiz_test_publication_control_v2(
  singleton, score_repair_ready
) VALUES (true, false)
ON CONFLICT (singleton) DO UPDATE
SET score_repair_ready = false;

REVOKE ALL ON TABLE private.quiz_test_publication_control_v2
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.guard_test_quiz_result_publication_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ready boolean := false;
BEGIN
  IF NEW.contract_version <> 2
    OR NEW.mode <> 'test'
    OR OLD.results_published_at IS NOT NULL
    OR NEW.results_published_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT control.score_repair_ready
  INTO v_ready
  FROM private.quiz_test_publication_control_v2 AS control
  WHERE control.singleton;

  IF COALESCE(v_ready, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'quiz_test_score_publication_not_ready';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_test_quiz_result_publication_v2
  ON public.quiz_events;
CREATE TRIGGER guard_test_quiz_result_publication_v2
BEFORE UPDATE OF results_published_at ON public.quiz_events
FOR EACH ROW
EXECUTE FUNCTION private.guard_test_quiz_result_publication_v2();

ALTER FUNCTION private.guard_test_quiz_result_publication_v2()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_test_quiz_result_publication_v2()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

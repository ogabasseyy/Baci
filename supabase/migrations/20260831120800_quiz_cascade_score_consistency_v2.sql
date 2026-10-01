-- Keep incremental v2 scores consistent when device-integrity enforcement
-- deletes attempt questions and cascades their accepted answers.

BEGIN;

CREATE OR REPLACE FUNCTION private.subtract_deleted_quiz_question_score_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contract_version integer;
  v_score_delta integer := 0;
BEGIN
  SELECT event.contract_version
  INTO v_contract_version
  FROM public.quiz_attempts AS attempt
  JOIN public.quiz_events AS event ON event.id = attempt.event_id
  WHERE attempt.id = OLD.attempt_id
  FOR UPDATE OF attempt;

  IF v_contract_version IS DISTINCT FROM 2 THEN
    RETURN OLD;
  END IF;

  SELECT COALESCE(pg_catalog.sum(answer.score_delta), 0)::integer
  INTO v_score_delta
  FROM public.quiz_attempt_answers AS answer
  WHERE answer.attempt_question_id = OLD.id;

  IF v_score_delta <> 0 THEN
    UPDATE public.quiz_attempts
    SET score = GREATEST(score - v_score_delta, 0)
    WHERE id = OLD.attempt_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS subtract_deleted_quiz_question_score_v2
  ON public.quiz_attempt_questions;
CREATE TRIGGER subtract_deleted_quiz_question_score_v2
BEFORE DELETE ON public.quiz_attempt_questions
FOR EACH ROW
EXECUTE FUNCTION private.subtract_deleted_quiz_question_score_v2();

ALTER FUNCTION private.subtract_deleted_quiz_question_score_v2()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subtract_deleted_quiz_question_score_v2()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

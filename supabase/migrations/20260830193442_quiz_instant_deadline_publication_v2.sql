-- Publish v2 quiz results from the database clock, persist accepted scores
-- incrementally, and wake players with one payload-free private broadcast.

BEGIN;

CREATE OR REPLACE FUNCTION private.accumulate_quiz_attempt_score_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.quiz_attempts AS attempt
  SET score = COALESCE(attempt.score, 0) + COALESCE(NEW.score_delta, 0)
  FROM public.quiz_attempt_questions AS question, public.quiz_events AS event
  WHERE question.id = NEW.attempt_question_id
    AND attempt.id = question.attempt_id
    AND event.id = attempt.event_id
    AND event.contract_version = 2;
  RETURN NEW;
END;
$$;

ALTER FUNCTION private.accumulate_quiz_attempt_score_v2() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.accumulate_quiz_attempt_score_v2()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS accumulate_quiz_attempt_score_v2
  ON public.quiz_attempt_answers;
CREATE TRIGGER accumulate_quiz_attempt_score_v2
AFTER INSERT ON public.quiz_attempt_answers
FOR EACH ROW EXECUTE FUNCTION private.accumulate_quiz_attempt_score_v2();

-- Repair attempts accepted before the incremental trigger existed. Updating
-- score also refreshes the existing indexed quiz_live_standings_v2 row.
WITH corrected AS (
  SELECT attempt.id,
    COALESCE(pg_catalog.sum(answer.score_delta), 0)::integer AS score
  FROM public.quiz_attempts AS attempt
  JOIN public.quiz_events AS event ON event.id = attempt.event_id
  LEFT JOIN public.quiz_attempt_questions AS question
    ON question.attempt_id = attempt.id
  LEFT JOIN public.quiz_attempt_answers AS answer
    ON answer.attempt_question_id = question.id
  WHERE event.contract_version = 2
  GROUP BY attempt.id
)
UPDATE public.quiz_attempts AS attempt
SET score = corrected.score
FROM corrected
WHERE attempt.id = corrected.id
  AND attempt.score IS DISTINCT FROM corrected.score;

COMMIT;

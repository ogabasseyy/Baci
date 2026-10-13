-- Serialize the one-time v2 score repair with answer inserts. The earlier
-- repair ran after installing the incremental trigger, so an answer committed
-- between its aggregate snapshot and attempt update could be overwritten.

BEGIN;

LOCK TABLE public.quiz_attempt_answers IN SHARE ROW EXCLUSIVE MODE;

WITH corrected AS (
  SELECT
    attempt.id,
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

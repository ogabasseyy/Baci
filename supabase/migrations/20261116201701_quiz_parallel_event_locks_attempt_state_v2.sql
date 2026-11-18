-- Let quiz players run in parallel (part 2: attempt-state projection).
-- Called by start, answer and resume. Shares the quiz_events row instead of
-- taking it exclusively; see 20261116201700 for the full reasoning.
--
-- Part 2 of 5 (20261116201700 .. 20261116201704). Order matters: a request
-- locks the event row several times in one transaction (device start ->
-- start core -> attempt state -> device binding; answer -> attempt state;
-- resume -> attempt state). A function may only start sharing once every
-- function that runs after it in the same request already shares; otherwise
-- a request would hold FOR SHARE and then ask for FOR UPDATE, and two such
-- requests deadlock on the upgrade. So the last-called function is converted
-- first: device binding, attempt state, start core, answer, then resume and
-- the device start wrapper. Every intermediate state keeps "FOR UPDATE first,
-- FOR SHARE after", so each part is safe to commit on its own.
--
-- Body otherwise byte-for-byte the deployed definition (20260804100000).

BEGIN;

CREATE OR REPLACE FUNCTION private.quiz_attempt_state_v2(
  p_attempt_id uuid,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt public.quiz_attempts%ROWTYPE;
  v_event public.quiz_events%ROWTYPE;
  v_question public.quiz_attempt_questions%ROWTYPE;
  v_deadline timestamptz;
  v_options jsonb;
  v_prompt text;
  v_total integer;
BEGIN
  SELECT event.*
  INTO v_event
  FROM public.quiz_events AS event
  JOIN public.quiz_attempts AS attempt ON attempt.event_id = event.id
  WHERE attempt.id = p_attempt_id
  FOR SHARE OF event;

  SELECT attempt.*
  INTO v_attempt
  FROM public.quiz_attempts AS attempt
  WHERE attempt.id = p_attempt_id
  FOR UPDATE;

  IF v_attempt.id IS NULL OR v_event.id IS NULL THEN
    RAISE EXCEPTION 'quiz_attempt_not_found' USING ERRCODE = 'QZ004';
  END IF;

  -- Lock waits count against both clocks. Never retain a caller timestamp that
  -- predates the authoritative event/attempt locks.
  p_now := pg_catalog.clock_timestamp();

  IF v_event.status = 'cancelled' THEN
    UPDATE public.quiz_attempts
    SET status = 'event_cancelled',
        submitted_at = COALESCE(submitted_at, p_now)
    WHERE id = v_attempt.id AND status = 'started';
    RETURN pg_catalog.jsonb_build_object(
      'attemptId', v_attempt.id,
      'eventId', v_event.id,
      'status', 'event_cancelled',
      'serverNow', p_now,
      'eventEndsAt', v_event.ends_at,
      'resultsAvailableAt', NULL
    );
  END IF;

  IF p_now >= v_event.ends_at OR v_attempt.status <> 'started' THEN
    IF v_attempt.status = 'started' THEN
      UPDATE public.quiz_attempts
      SET status = 'submitted',
          submitted_at = COALESCE(submitted_at, p_now)
      WHERE id = v_attempt.id;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'attemptId', v_attempt.id,
      'eventId', v_event.id,
      'status', CASE
        WHEN v_event.results_published_at IS NULL THEN 'submitted_pending_results'
        ELSE 'completed'
      END,
      'serverNow', p_now,
      'eventEndsAt', v_event.ends_at,
      'resultsAvailableAt', v_event.results_published_at
    );
  END IF;

  SELECT question.*
  INTO v_question
  FROM public.quiz_attempt_questions AS question
  WHERE question.attempt_id = v_attempt.id
    AND NOT EXISTS (
      SELECT 1
      FROM public.quiz_attempt_answers AS answer
      WHERE answer.attempt_question_id = question.id
    )
  ORDER BY question.position
  LIMIT 1
  FOR UPDATE;

  IF v_question.id IS NULL THEN
    UPDATE public.quiz_attempts
    SET status = 'submitted',
        submitted_at = COALESCE(submitted_at, p_now)
    WHERE id = v_attempt.id;
    RETURN pg_catalog.jsonb_build_object(
      'attemptId', v_attempt.id,
      'eventId', v_event.id,
      'status', 'submitted_pending_results',
      'serverNow', p_now,
      'eventEndsAt', v_event.ends_at,
      'resultsAvailableAt', v_event.results_published_at
    );
  END IF;

  IF v_question.issued_at IS NOT NULL THEN
    v_deadline := public.quiz_effective_question_deadline_v2(
      v_question.issued_at,
      v_event.ends_at,
      v_event.time_per_question_seconds
    );
    IF p_now >= v_deadline THEN
      INSERT INTO public.quiz_attempt_answers (
        attempt_question_id,
        answer_payload,
        answered_at,
        answered_in_ms,
        score_delta
      ) VALUES (
        v_question.id,
        pg_catalog.jsonb_build_object('timeout', true, 'v2', true),
        v_deadline,
        LEAST(v_event.time_per_question_seconds * 1000, 60000),
        0
      )
      ON CONFLICT (attempt_question_id) DO NOTHING;

      SELECT question.*
      INTO v_question
      FROM public.quiz_attempt_questions AS question
      WHERE question.attempt_id = v_attempt.id
        AND NOT EXISTS (
          SELECT 1
          FROM public.quiz_attempt_answers AS answer
          WHERE answer.attempt_question_id = question.id
        )
      ORDER BY question.position
      LIMIT 1
      FOR UPDATE;
    END IF;
  END IF;

  IF v_question.id IS NULL OR p_now >= v_event.ends_at THEN
    UPDATE public.quiz_attempts
    SET status = 'submitted',
        submitted_at = COALESCE(submitted_at, p_now)
    WHERE id = v_attempt.id;
    RETURN pg_catalog.jsonb_build_object(
      'attemptId', v_attempt.id,
      'eventId', v_event.id,
      'status', 'submitted_pending_results',
      'serverNow', p_now,
      'eventEndsAt', v_event.ends_at,
      'resultsAvailableAt', v_event.results_published_at
    );
  END IF;

  IF v_question.issued_at IS NULL THEN
    UPDATE public.quiz_attempt_questions
    SET issued_at = p_now,
        time_limit_ms = v_event.time_per_question_seconds * 1000
    WHERE id = v_question.id
    RETURNING * INTO v_question;
  END IF;

  v_deadline := public.quiz_effective_question_deadline_v2(
    v_question.issued_at,
    v_event.ends_at,
    v_event.time_per_question_seconds
  );

  SELECT
    variant.prompt,
    COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(ordered.option_value ORDER BY ordered.option_position)
        FROM (
          SELECT
            option.value AS option_value,
            COALESCE(
              (
                SELECT ordering.ordinality
                FROM pg_catalog.jsonb_array_elements_text(v_question.option_order)
                  WITH ORDINALITY AS ordering(option_id, ordinality)
                WHERE ordering.option_id = option.value->>'id'
                LIMIT 1
              ),
              2147483647
            ) AS option_position
          FROM pg_catalog.jsonb_array_elements(variant.options) AS option(value)
        ) AS ordered
      ),
      '[]'::jsonb
    )
  INTO v_prompt, v_options
  FROM public.quiz_question_variants AS variant
  WHERE variant.id = v_question.variant_id;

  SELECT pg_catalog.count(*)::integer
  INTO v_total
  FROM public.quiz_attempt_questions
  WHERE attempt_id = v_attempt.id;

  RETURN pg_catalog.jsonb_build_object(
    'attemptId', v_attempt.id,
    'eventId', v_event.id,
    'status', 'in_progress',
    'serverNow', p_now,
    'eventEndsAt', v_event.ends_at,
    'resultsAvailableAt', v_event.results_published_at,
    'question', pg_catalog.jsonb_build_object(
      'id', v_question.id,
      'prompt', v_prompt,
      'options', v_options,
      'timeLimitSeconds', v_event.time_per_question_seconds,
      'index', v_question.position,
      'total', v_total,
      'issuedAt', v_question.issued_at,
      'deadlineAt', v_deadline
    )
  );
END;
$$;

COMMIT;

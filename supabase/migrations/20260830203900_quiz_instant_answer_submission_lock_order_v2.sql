-- Acquire the answer-table lock before attempt rows so the one-time score
-- repair and concurrent answer submissions use the same lock order.

BEGIN;

CREATE OR REPLACE FUNCTION public.submit_quiz_answer_v2(
  p_attempt_id uuid,
  p_question_id uuid,
  p_answer text,
  p_route_proof jsonb,
  p_user_id uuid,
  p_client_answered_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_answer_hash text;
  v_answered_in_ms bigint;
  v_attempt public.quiz_attempts%ROWTYPE;
  v_deadline timestamptz;
  v_event public.quiz_events%ROWTYPE;
  v_now timestamptz;
  v_question public.quiz_attempt_questions%ROWTYPE;
  v_score_delta integer;
BEGIN
  IF p_user_id IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'quiz_attempt_not_found' USING ERRCODE = 'QZ004';
  END IF;
  IF NOT public.quiz_route_proof_valid(
    p_route_proof,
    'submit_quiz_answer_v2',
    p_attempt_id::text || ':' || p_question_id::text,
    p_user_id
  ) THEN
    RAISE EXCEPTION 'quiz route proof required' USING ERRCODE = 'QZ010';
  END IF;

  -- Row-exclusive locks are mutually compatible, so submissions still run in
  -- parallel. Taking it before event/attempt rows only orders maintenance.
  LOCK TABLE public.quiz_attempt_answers IN ROW EXCLUSIVE MODE;

  SELECT event.*
  INTO v_event
  FROM public.quiz_events AS event
  JOIN public.quiz_attempts AS attempt ON attempt.event_id = event.id
  WHERE attempt.id = p_attempt_id
  FOR UPDATE OF event;

  SELECT attempt.*
  INTO v_attempt
  FROM public.quiz_attempts AS attempt
  JOIN public.customers AS customer ON customer.id = attempt.customer_id
  WHERE attempt.id = p_attempt_id
    AND customer.user_id = p_user_id
    AND customer.deleted_at IS NULL
  FOR UPDATE OF attempt;

  v_now := pg_catalog.clock_timestamp();

  IF v_attempt.id IS NULL OR v_event.contract_version <> 2 THEN
    RAISE EXCEPTION 'quiz_attempt_not_found' USING ERRCODE = 'QZ004';
  END IF;
  IF v_event.status = 'cancelled' THEN
    RETURN private.quiz_attempt_state_v2(v_attempt.id, v_now);
  END IF;
  IF v_attempt.status <> 'started' OR v_now >= v_event.ends_at THEN
    RETURN private.quiz_attempt_state_v2(v_attempt.id, v_now);
  END IF;

  SELECT question.*
  INTO v_question
  FROM public.quiz_attempt_questions AS question
  WHERE question.id = p_question_id
    AND question.attempt_id = v_attempt.id
  FOR UPDATE;

  v_now := pg_catalog.clock_timestamp();

  IF v_now >= v_event.ends_at THEN
    RETURN private.quiz_attempt_state_v2(v_attempt.id, v_now);
  END IF;

  IF v_question.id IS NULL OR v_question.issued_at IS NULL THEN
    RAISE EXCEPTION 'quiz_question_not_issued' USING ERRCODE = 'QZ027';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.quiz_attempt_answers AS answer
    WHERE answer.attempt_question_id = v_question.id
  ) THEN
    RETURN private.quiz_attempt_state_v2(v_attempt.id, v_now);
  END IF;

  v_deadline := public.quiz_effective_question_deadline_v2(
    v_question.issued_at,
    v_event.ends_at,
    v_event.time_per_question_seconds
  );
  v_answered_in_ms := GREATEST(
    0,
    pg_catalog.floor(
      EXTRACT(epoch FROM (v_now - v_question.issued_at)) * 1000
    )::bigint
  );
  v_answer_hash := public.quiz_answer_key_hash(p_answer);

  SELECT CASE
    WHEN v_now >= v_deadline THEN 0
    WHEN public.quiz_answer_key_matches(p_answer, variant.answer_key_hash) THEN 1
    ELSE 0
  END
  INTO v_score_delta
  FROM public.quiz_question_variants AS variant
  WHERE variant.id = v_question.variant_id;

  INSERT INTO public.quiz_attempt_answers (
    attempt_question_id,
    answer_payload,
    answered_at,
    answered_in_ms,
    score_delta
  ) VALUES (
    v_question.id,
    pg_catalog.jsonb_build_object(
      'selected_answer_hash', v_answer_hash,
      'late', v_now >= v_deadline,
      'v2', true
    ),
    v_now,
    LEAST(v_answered_in_ms, 60000)::integer,
    COALESCE(v_score_delta, 0)
  )
  ON CONFLICT (attempt_question_id) DO NOTHING;

  RETURN private.quiz_attempt_state_v2(v_attempt.id, v_now);
END;
$$;

ALTER FUNCTION public.submit_quiz_answer_v2(
  uuid, uuid, text, jsonb, uuid, timestamptz
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.submit_quiz_answer_v2(
  uuid, uuid, text, jsonb, uuid, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz_answer_v2(
  uuid, uuid, text, jsonb, uuid, timestamptz
) TO authenticated;

COMMIT;

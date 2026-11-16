-- Let quiz players run in parallel.
--
-- Every player request (start, answer, resume and the shared attempt-state
-- projection) took FOR UPDATE on the single quiz_events row, so one event
-- processed one request at a time and every other player queued behind it.
-- Players now take FOR SHARE on that row instead:
--   * players no longer block each other (FOR SHARE is self-compatible);
--   * the closing paths are unchanged and still take FOR UPDATE (terminalize,
--     finalize, award transfer) or UPDATE the row (cancel, launch), which
--     conflicts with FOR SHARE, so no answer can land while an event is being
--     closed and no close can start while an answer is in flight.
-- Per-player safety stays where it already was: the attempt row lock and the
-- per-customer / per-device advisory locks.
--
-- All six functions change in one transaction. A mixed state (one function
-- sharing, a later one in the same request asking for FOR UPDATE) would turn
-- two concurrent players into a lock-upgrade deadlock.
--
-- submit_quiz_answer_v2 also stops charging queue time to the player: the
-- per-question deadline and answered_in_ms use the server clock read when the
-- answer reached the database, before any lock. The universal event end keeps
-- using the clock read after the locks, exactly as before.
--
-- Known edge, not changed here: when a player's own resume request reaches
-- the attempt first and runs after the question deadline, it records the
-- timeout answer, and an answer from the same player that arrived just before
-- the deadline but ran second is not credited. Both requests have to be
-- queued on that one attempt across the deadline. Reconciling it would mean
-- rewriting a recorded answer (and sometimes an already submitted attempt),
-- which is deliberately kept out of this change.
--
-- Function bodies are otherwise byte-for-byte the deployed definitions
-- (20260804100000, 20260804123000, 20260830203900, 20260830203960,
-- 20261116090000). CREATE OR REPLACE keeps each function's owner and grants.

BEGIN;

-- 1. Attempt-state projection (called by start, answer and resume).
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

-- 2. Device binding (called by the device start wrapper).
CREATE OR REPLACE FUNCTION private.quiz_bind_attempt_device_v2(
  p_attempt_id uuid,
  p_device_hash text,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt public.quiz_attempts%ROWTYPE;
  v_bound_hash text;
  v_customer_id uuid;
  v_event public.quiz_events%ROWTYPE;
  v_other_customer_count integer;
  v_same_customer_count integer;
BEGIN
  IF p_device_hash !~ '^[0-9a-f]{64}$' OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'quiz_device_hash_invalid' USING ERRCODE = 'QZ042';
  END IF;

  SELECT event.*
  INTO v_event
  FROM public.quiz_events AS event
  JOIN public.quiz_attempts AS attempt ON attempt.event_id = event.id
  WHERE attempt.id = p_attempt_id
  FOR SHARE OF event;

  SELECT attempt.*
  INTO v_attempt
  FROM public.quiz_attempts AS attempt
  JOIN public.customers AS customer ON customer.id = attempt.customer_id
  WHERE attempt.id = p_attempt_id
    AND customer.user_id = p_user_id
    AND customer.deleted_at IS NULL
  FOR UPDATE OF attempt;

  IF v_attempt.id IS NULL OR v_event.contract_version <> 2 THEN
    RAISE EXCEPTION 'quiz_attempt_not_found' USING ERRCODE = 'QZ004';
  END IF;
  v_customer_id := v_attempt.customer_id;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    ('x' || pg_catalog.substr(
      pg_catalog.md5(v_event.id::text || ':' || p_device_hash),
      1,
      16
    ))::bit(64)::bigint
  );

  INSERT INTO public.quiz_attempt_devices (
    attempt_id,
    event_id,
    device_hash
  ) VALUES (
    v_attempt.id,
    v_event.id,
    p_device_hash
  )
  ON CONFLICT (attempt_id) DO NOTHING;

  SELECT device.device_hash
  INTO v_bound_hash
  FROM public.quiz_attempt_devices AS device
  WHERE device.attempt_id = v_attempt.id
  FOR UPDATE;

  IF v_bound_hash IS DISTINCT FROM p_device_hash THEN
    RAISE EXCEPTION 'quiz_device_binding_conflict' USING ERRCODE = 'QZ043';
  END IF;

  SELECT pg_catalog.count(DISTINCT attempt.customer_id)::integer
  INTO v_other_customer_count
  FROM public.quiz_attempt_devices AS device
  JOIN public.quiz_attempts AS attempt ON attempt.id = device.attempt_id
  WHERE device.event_id = v_event.id
    AND device.device_hash = p_device_hash
    AND attempt.customer_id <> v_customer_id;

  SELECT pg_catalog.count(*)::integer
  INTO v_same_customer_count
  FROM public.quiz_attempt_devices AS device
  JOIN public.quiz_attempts AS attempt ON attempt.id = device.attempt_id
  WHERE device.event_id = v_event.id
    AND device.device_hash = p_device_hash
    AND attempt.customer_id = v_customer_id
    AND attempt.status <> 'test_reset';

  IF v_other_customer_count > 0
    OR v_same_customer_count > v_event.max_attempts THEN
    UPDATE public.quiz_attempts
    SET status = 'disqualified'
    WHERE id = v_attempt.id;
    UPDATE public.quiz_attempt_devices
    SET allowed = false
    WHERE attempt_id = v_attempt.id;
    DELETE FROM public.quiz_attempt_questions
    WHERE attempt_id = v_attempt.id;
    RETURN false;
  END IF;

  UPDATE public.quiz_attempt_devices
  SET allowed = true
  WHERE attempt_id = v_attempt.id;
  RETURN true;
END;
$$;

-- 3. Start core.
CREATE OR REPLACE FUNCTION private.start_quiz_attempt_v2_core(
  p_event_id uuid,
  p_integrity_tier text,
  p_accepted_rules_version text,
  p_terms_accepted boolean,
  p_start_request_id uuid,
  p_app_version text,
  p_platform text,
  p_route_proof jsonb,
  p_user_id uuid,
  p_allow_live boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt_id uuid;
  v_attempt_number integer;
  v_attempt_count integer;
  v_customer public.customers%ROWTYPE;
  v_event public.quiz_events%ROWTYPE;
  v_existing_attempt uuid;
  v_inserted_questions integer;
  v_now timestamptz;
BEGIN
  IF p_user_id IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'quiz_attempt_not_found' USING ERRCODE = 'QZ004';
  END IF;
  IF p_start_request_id IS NULL THEN
    RAISE EXCEPTION 'quiz_start_request_required' USING ERRCODE = 'QZ400';
  END IF;
  IF NOT public.quiz_route_proof_valid(
    p_route_proof,
    'start_quiz_attempt_v2',
    p_event_id::text || ':' || p_start_request_id::text,
    p_user_id
  ) THEN
    RAISE EXCEPTION 'quiz route proof required' USING ERRCODE = 'QZ010';
  END IF;

  -- Match every v2 answer writer with the table-first order used by the
  -- one-time score repair. ROW EXCLUSIVE remains compatible across players.
  LOCK TABLE public.quiz_attempt_answers IN ROW EXCLUSIVE MODE;

  SELECT event.*
  INTO v_event
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id
  FOR SHARE;

  -- Capture time only after acquiring the event lock so a blocked start cannot
  -- cross the universal end with a stale pre-lock timestamp.
  v_now := pg_catalog.clock_timestamp();

  IF v_event.id IS NULL
    OR v_event.contract_version <> 2
    OR v_event.status <> 'active'
    OR v_event.starts_at > v_now
    OR v_event.ends_at <= v_now THEN
    RAISE EXCEPTION 'quiz_event_not_open' USING ERRCODE = 'QZ002';
  END IF;
  IF v_event.mode = 'live' AND NOT p_allow_live THEN
    RAISE EXCEPTION 'quiz_device_binding_required' USING ERRCODE = 'QZ040';
  END IF;
  IF NOT COALESCE(p_terms_accepted, false)
    OR p_accepted_rules_version IS DISTINCT FROM v_event.rules_version THEN
    RAISE EXCEPTION 'quiz_rules_acceptance_required' USING ERRCODE = 'QZ400';
  END IF;
  IF p_platform NOT IN ('android', 'ios', 'web')
    OR p_app_version IS NULL
    OR pg_catalog.length(pg_catalog.btrim(p_app_version)) = 0 THEN
    RAISE EXCEPTION 'quiz_client_metadata_invalid' USING ERRCODE = 'QZ400';
  END IF;

  SELECT customer.*
  INTO v_customer
  FROM public.customers AS customer
  WHERE customer.user_id = p_user_id
    AND customer.merchant_id = v_event.merchant_id
    AND customer.deleted_at IS NULL
  ORDER BY customer.created_at DESC, customer.id DESC
  LIMIT 1;

  IF v_customer.id IS NULL THEN
    RAISE EXCEPTION 'quiz_customer_not_found' USING ERRCODE = 'QZ001';
  END IF;
  IF v_customer.username IS NULL
    OR pg_catalog.length(pg_catalog.btrim(v_customer.username)) = 0 THEN
    RAISE EXCEPTION 'quiz_username_required' USING ERRCODE = 'QZ012';
  END IF;
  IF v_customer.date_of_birth IS NULL THEN
    RAISE EXCEPTION 'quiz_date_of_birth_required' USING ERRCODE = 'QZ013';
  END IF;
  -- Server-side 18+ gate for live (prize) quizzes. The web route also checks,
  -- but the public wrappers are executable by authenticated users directly, so
  -- the database must refuse under-18 players itself. Exact 18th birthday passes.
  IF v_event.mode = 'live'
    AND v_customer.date_of_birth > (
      (v_now AT TIME ZONE 'UTC')::date
      - INTERVAL '18 years'
    )::date THEN
    RAISE EXCEPTION 'quiz_age_restricted' USING ERRCODE = 'QZ014';
  END IF;
  IF v_event.mode = 'test'
    AND NOT public.has_merchant_access(v_event.merchant_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.quiz_event_testers AS tester
      WHERE tester.event_id = v_event.id
        AND tester.user_id = p_user_id
        AND tester.revoked_at IS NULL
    ) THEN
    RAISE EXCEPTION 'quiz_test_access_required' USING ERRCODE = 'QZ403';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    ('x' || pg_catalog.substr(
      pg_catalog.md5(v_event.id::text || ':' || v_customer.id::text),
      1,
      16
    ))::bit(64)::bigint
  );

  v_now := pg_catalog.clock_timestamp();
  IF v_now >= v_event.ends_at THEN
    RAISE EXCEPTION 'quiz_event_not_open' USING ERRCODE = 'QZ002';
  END IF;

  SELECT attempt.id
  INTO v_existing_attempt
  FROM public.quiz_attempts AS attempt
  WHERE attempt.event_id = v_event.id
    AND attempt.customer_id = v_customer.id
    AND attempt.status = 'started'
  ORDER BY attempt.created_at DESC, attempt.id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing_attempt IS NOT NULL THEN
    RETURN private.quiz_attempt_state_v2(v_existing_attempt, v_now)
      || pg_catalog.jsonb_build_object('resumed', true);
  END IF;

  SELECT attempt.id
  INTO v_existing_attempt
  FROM public.quiz_attempts AS attempt
  WHERE attempt.event_id = v_event.id
    AND attempt.customer_id = v_customer.id
    AND attempt.start_request_id = p_start_request_id
  LIMIT 1
  FOR UPDATE;

  IF v_existing_attempt IS NOT NULL THEN
    RETURN private.quiz_attempt_state_v2(v_existing_attempt, v_now)
      || pg_catalog.jsonb_build_object('resumed', true);
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_attempt_count
  FROM public.quiz_attempts AS attempt
  WHERE attempt.event_id = v_event.id
    AND attempt.customer_id = v_customer.id
    AND attempt.status <> 'test_reset';

  IF v_attempt_count >= v_event.max_attempts THEN
    RAISE EXCEPTION 'attempt_limit_reached' USING ERRCODE = 'QZ030';
  END IF;

  SELECT COALESCE(pg_catalog.max(attempt.attempt_number), 0) + 1
  INTO v_attempt_number
  FROM public.quiz_attempts AS attempt
  WHERE attempt.event_id = v_event.id
    AND attempt.customer_id = v_customer.id;

  v_now := pg_catalog.clock_timestamp();
  IF v_now >= v_event.ends_at THEN
    RAISE EXCEPTION 'quiz_event_not_open' USING ERRCODE = 'QZ002';
  END IF;

  INSERT INTO public.quiz_attempts (
    event_id,
    customer_id,
    attempt_number,
    integrity_tier,
    route_proof_id,
    leaderboard_username,
    rules_version,
    terms_accepted_at,
    app_version,
    platform,
    start_request_id
  ) VALUES (
    v_event.id,
    v_customer.id,
    v_attempt_number,
    COALESCE(NULLIF(pg_catalog.btrim(p_integrity_tier), ''), 'unknown'),
    p_route_proof->>'proof_id',
    pg_catalog.btrim(v_customer.username),
    v_event.rules_version,
    v_now,
    pg_catalog.btrim(p_app_version),
    p_platform,
    p_start_request_id
  )
  RETURNING id INTO v_attempt_id;

  WITH selected AS (
    SELECT
      slot.id AS slot_id,
      variant.id AS variant_id,
      pg_catalog.row_number() OVER (ORDER BY slot.slot_index)::integer AS position,
      COALESCE(
        (
          SELECT pg_catalog.jsonb_agg(
            option.value->>'id'
            ORDER BY pg_catalog.md5(
              option.value->>'id' || ':' || v_attempt_id::text
            )
          )
          FROM pg_catalog.jsonb_array_elements(variant.options) AS option(value)
        ),
        '[]'::jsonb
      ) AS option_order
    FROM public.quiz_question_slots AS slot
    JOIN LATERAL (
      SELECT candidate.*
      FROM public.quiz_question_variants AS candidate
      WHERE candidate.slot_id = slot.id
        AND candidate.active
        AND candidate.answer_key_hash ~ '^[0-9a-f]{64}$'
      ORDER BY pg_catalog.md5(
        candidate.id::text || ':' || v_attempt_id::text
      )
      LIMIT 1
    ) AS variant ON true
    WHERE slot.event_id = v_event.id
      AND slot.active
    ORDER BY slot.slot_index
    LIMIT v_event.question_count
  )
  INSERT INTO public.quiz_attempt_questions (
    attempt_id,
    slot_id,
    variant_id,
    position,
    option_order,
    time_limit_ms
  )
  SELECT
    v_attempt_id,
    selected.slot_id,
    selected.variant_id,
    selected.position,
    selected.option_order,
    v_event.time_per_question_seconds * 1000
  FROM selected;

  GET DIAGNOSTICS v_inserted_questions = ROW_COUNT;
  IF v_inserted_questions <> v_event.question_count THEN
    RAISE EXCEPTION 'quiz_question_pool_incomplete' USING ERRCODE = 'QZ003';
  END IF;

  RETURN private.quiz_attempt_state_v2(v_attempt_id, v_now)
    || pg_catalog.jsonb_build_object('resumed', false);
END;
$$;

-- 4. Device start wrapper.
CREATE OR REPLACE FUNCTION public.start_quiz_attempt_with_device_v2(
  p_event_id uuid,
  p_integrity_tier text,
  p_device_hash text,
  p_start_route_proof jsonb,
  p_device_route_proof jsonb,
  p_accepted_rules_version text,
  p_terms_accepted boolean,
  p_start_request_id uuid,
  p_app_version text,
  p_platform text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt_id uuid;
  v_binding_diagnostic text;
  v_device_allowed boolean;
  v_event public.quiz_events%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'quiz_attempt_not_found' USING ERRCODE = 'QZ004';
  END IF;
  IF NOT public.quiz_route_proof_valid(
    p_device_route_proof,
    'start_quiz_attempt_with_device_v2',
    public.quiz_device_proof_subject(p_event_id, p_device_hash),
    p_user_id
  ) THEN
    RAISE EXCEPTION 'quiz route proof required' USING ERRCODE = 'QZ010';
  END IF;
  SELECT event.* INTO v_event
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id
  FOR SHARE;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'quiz_event_not_found' USING ERRCODE = 'QZ003';
  END IF;
  IF v_event.mode = 'live' AND NOT private.quiz_live_prize_regulatory_ready_v2(v_event.id) THEN
    RAISE EXCEPTION 'quiz_live_regulatory_readiness_required' USING ERRCODE = 'QZ047';
  END IF;

  v_result := private.start_quiz_attempt_v2_core(
    p_event_id, p_integrity_tier, p_accepted_rules_version, p_terms_accepted,
    p_start_request_id, p_app_version, p_platform, p_start_route_proof,
    p_user_id, true
  );
  v_attempt_id := NULLIF(v_result->>'attemptId', '')::uuid;
  BEGIN
    v_device_allowed := private.quiz_bind_attempt_device_v2(v_attempt_id, p_device_hash, p_user_id);
  EXCEPTION
    WHEN SQLSTATE '55P03' OR SQLSTATE '57014' OR SQLSTATE '40001' OR SQLSTATE '40P01' THEN
      IF v_event.mode = 'live' THEN
        RAISE EXCEPTION 'quiz_device_binding_unavailable' USING ERRCODE = 'QZ044';
      END IF;
      v_device_allowed := true;
      v_binding_diagnostic := 'binding_temporarily_unavailable';
  END;
  IF NOT COALESCE(v_device_allowed, false) THEN
    IF v_event.mode = 'live' THEN
      RAISE EXCEPTION 'quiz_device_limit_reached' USING ERRCODE = 'QZ041';
    END IF;
    v_binding_diagnostic := 'device_limit_reached';
  END IF;
  RETURN v_result || pg_catalog.jsonb_build_object(
    'deviceAllowed', v_device_allowed,
    'deviceBindingDiagnostic', v_binding_diagnostic
  );
END;
$$;

-- 5. Answer submission.
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
  -- Server clock when this answer reached the database, read before any lock
  -- is requested. Time spent queueing behind other requests must not make an
  -- on-time answer late, so the per-question deadline uses this instant.
  v_received_at timestamptz := pg_catalog.clock_timestamp();
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
  FOR SHARE OF event;

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
      EXTRACT(epoch FROM (v_received_at - v_question.issued_at)) * 1000
    )::bigint
  );
  v_answer_hash := public.quiz_answer_key_hash(p_answer);

  SELECT CASE
    WHEN v_received_at >= v_deadline THEN 0
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
      'late', v_received_at >= v_deadline,
      'v2', true
    ),
    v_received_at,
    LEAST(v_answered_in_ms, 60000)::integer,
    COALESCE(v_score_delta, 0)
  )
  ON CONFLICT (attempt_question_id) DO NOTHING;

  RETURN private.quiz_attempt_state_v2(v_attempt.id, v_now);
END;
$$;

-- 6. Resume.
CREATE OR REPLACE FUNCTION public.resume_quiz_attempt_v2(
  p_event_id uuid,
  p_device_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt_id uuid;
  v_customer_id uuid;
  v_event public.quiz_events%ROWTYPE;
  v_state jsonb;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'quiz_auth_required' USING ERRCODE = 'QZ401';
  END IF;

  -- Resume may insert a timeout answer. Acquire the compatible writer lock
  -- before event and attempt rows so score repair cannot form a lock cycle.
  LOCK TABLE public.quiz_attempt_answers IN ROW EXCLUSIVE MODE;

  SELECT event.*
  INTO v_event
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id
    AND event.contract_version = 2
  FOR SHARE;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'quiz_event_not_found' USING ERRCODE = 'QZ003';
  END IF;

  SELECT customer.id
  INTO v_customer_id
  FROM public.customers AS customer
  WHERE customer.user_id = v_user_id
    AND customer.merchant_id = v_event.merchant_id
    AND customer.deleted_at IS NULL
  ORDER BY customer.created_at DESC, customer.id DESC
  LIMIT 1;

  SELECT attempt.id
  INTO v_attempt_id
  FROM public.quiz_attempts AS attempt
  WHERE attempt.event_id = v_event.id
    AND attempt.customer_id = v_customer_id
    AND attempt.status = 'started'
  ORDER BY attempt.created_at DESC, attempt.id DESC
  LIMIT 1
  FOR UPDATE;

  -- Prefer a live attempt above. If none exists, a submitted attempt is still
  -- recoverable while the event is open because its result may be pending.
  IF v_attempt_id IS NULL THEN
    SELECT attempt.id
    INTO v_attempt_id
    FROM public.quiz_attempts AS attempt
    WHERE attempt.event_id = v_event.id
      AND attempt.customer_id = v_customer_id
      AND attempt.status IN ('submitted', 'event_cancelled')
    ORDER BY attempt.created_at DESC, attempt.id DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_attempt_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'availability', CASE
        WHEN v_event.status = 'cancelled' THEN 'cancelled'
        WHEN pg_catalog.clock_timestamp() >= v_event.ends_at THEN 'unavailable'
        ELSE 'none'
      END,
      'serverNow', pg_catalog.clock_timestamp(),
      'eventEndsAt', v_event.ends_at
    );
  END IF;

  IF v_event.mode = 'live' THEN
    IF p_device_hash IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.quiz_attempt_devices AS device
      WHERE device.attempt_id = v_attempt_id
        AND device.device_hash = p_device_hash
        AND device.allowed
    ) THEN
      RAISE EXCEPTION 'quiz_device_binding_required' USING ERRCODE = 'QZ040';
    END IF;
  END IF;

  v_state := private.quiz_attempt_state_v2(
    v_attempt_id,
    pg_catalog.clock_timestamp()
  );

  RETURN CASE v_state->>'status'
    WHEN 'in_progress' THEN pg_catalog.jsonb_build_object(
      'availability', 'active',
      'serverNow', v_state->'serverNow',
      'eventEndsAt', v_state->'eventEndsAt',
      'attempt', v_state
    )
    WHEN 'event_cancelled' THEN pg_catalog.jsonb_build_object(
      'availability', 'cancelled',
      'attemptId', v_state->>'attemptId',
      'serverNow', v_state->'serverNow',
      'eventEndsAt', v_state->'eventEndsAt'
    )
    ELSE pg_catalog.jsonb_build_object(
      'availability', 'pending_results',
      'attemptId', v_state->>'attemptId',
      'serverNow', v_state->'serverNow',
      'eventEndsAt', v_state->'eventEndsAt'
    )
  END;
END;
$$;

COMMIT;

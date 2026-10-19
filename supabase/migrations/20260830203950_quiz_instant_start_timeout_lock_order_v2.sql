-- Order start/resume timeout writes before the one-time score repair.
-- This migration sorts before 20260830204000, so deployed functions acquire
-- the compatible writer lock before any event or attempt row lock.

BEGIN;

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
  FOR UPDATE;

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

ALTER FUNCTION private.start_quiz_attempt_v2_core(
  uuid, text, text, boolean, uuid, text, text, jsonb, uuid, boolean
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.start_quiz_attempt_v2_core(
  uuid, text, text, boolean, uuid, text, text, jsonb, uuid, boolean
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

-- Let quiz players run in parallel (part 5: resume and the device start
-- wrapper). Both share the quiz_events row instead of taking it exclusively;
-- see 20261116201700 for the full reasoning.
--
-- Part 5 of 5 (20261116201700 .. 20261116201704). Order matters: a request
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
-- Bodies otherwise byte-for-byte the deployed definitions (20260830203960
-- and 20260804123000).

BEGIN;

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

COMMIT;

-- Preserve the owner-scoped attempt id when recovery reaches the terminal
-- pending-results path. The mobile client may have persisted the start request
-- before the start response arrived, so the envelope cannot always provide it.
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

  SELECT event.*
  INTO v_event
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id
    AND event.contract_version = 2
  FOR UPDATE;

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

  -- A worker may have terminalized the attempt before the app can recover it.
  -- Only search terminal rows after the event window, so an older completed
  -- attempt cannot mask a new start while the event is still open.
  IF v_attempt_id IS NULL
     AND (
       v_event.status = 'cancelled'
       OR pg_catalog.clock_timestamp() >= v_event.ends_at
       OR v_event.results_published_at IS NOT NULL
     ) THEN
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

REVOKE ALL ON FUNCTION public.resume_quiz_attempt_v2(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resume_quiz_attempt_v2(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION public.resume_quiz_attempt_v2(uuid, text) IS
  'Owner-scoped v2 quiz recovery, including the attempt id for terminal result polling.';

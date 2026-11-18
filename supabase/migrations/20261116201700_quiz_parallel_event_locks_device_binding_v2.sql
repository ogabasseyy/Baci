-- Let quiz players run in parallel (part 1: device binding).
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
-- Part 1 of 5 (20261116201700 .. 20261116201704). Order matters: a request
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
-- Each function body is otherwise byte-for-byte the deployed definition
-- (here: 20260804100000). CREATE OR REPLACE keeps the owner and grants.

BEGIN;

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

COMMIT;

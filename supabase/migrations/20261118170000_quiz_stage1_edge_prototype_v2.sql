-- Stage 1 Edge Rooms prototype schema, admission check-in, trigger isolation,
-- restricted batch-consumer role, raw staging, set-wise scorer, and two-fact
-- publication gate for 100k / 1M quiz scale.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Event backend pinning & normalized-email expression index
-- ---------------------------------------------------------------------------
ALTER TABLE public.quiz_events
  ADD COLUMN IF NOT EXISTS backend_mode text NOT NULL DEFAULT 'postgres',
  ADD COLUMN IF NOT EXISTS expected_room_count integer,
  ADD COLUMN IF NOT EXISTS edge_persisted_close_at timestamptz,
  ADD COLUMN IF NOT EXISTS edge_manifest_checksum_sha256 text,
  ADD COLUMN IF NOT EXISTS edge_completed_scoring_run_id uuid;

ALTER TABLE public.quiz_events
  DROP CONSTRAINT IF EXISTS quiz_events_backend_mode_check;
ALTER TABLE public.quiz_events
  ADD CONSTRAINT quiz_events_backend_mode_check
  CHECK (backend_mode IN ('postgres', 'edge_rooms'));

ALTER TABLE public.quiz_events
  DROP CONSTRAINT IF EXISTS quiz_events_expected_room_count_check;
ALTER TABLE public.quiz_events
  ADD CONSTRAINT quiz_events_expected_room_count_check
  CHECK (expected_room_count IS NULL OR expected_room_count > 0);

ALTER TABLE public.quiz_events
  DROP CONSTRAINT IF EXISTS quiz_events_edge_manifest_checksum_check;
ALTER TABLE public.quiz_events
  ADD CONSTRAINT quiz_events_edge_manifest_checksum_check
  CHECK (
    edge_manifest_checksum_sha256 IS NULL
    OR edge_manifest_checksum_sha256 ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS backend_mode text NOT NULL DEFAULT 'postgres';

ALTER TABLE public.quiz_attempts
  DROP CONSTRAINT IF EXISTS quiz_attempts_backend_mode_check;
ALTER TABLE public.quiz_attempts
  ADD CONSTRAINT quiz_attempts_backend_mode_check
  CHECK (backend_mode IN ('postgres', 'edge_rooms'));

-- Candidate index for normalized-email cap lookups across active merchant
-- customers.
CREATE INDEX IF NOT EXISTS idx_customers_merchant_quiz_normalized_email
  ON public.customers (merchant_id, public.quiz_normalize_email(email))
  WHERE deleted_at IS NULL;

-- Unfiltered index so legacy quiz_enforce_identity_attempt_cap (which omits
-- deleted_at IS NULL) also uses an Index Scan instead of a Seq Scan.
CREATE INDEX IF NOT EXISTS idx_customers_merchant_quiz_normalized_email_all
  ON public.customers (merchant_id, public.quiz_normalize_email(email));

-- ---------------------------------------------------------------------------
-- 2. Admissions table & single atomic check-in RPC (no quiz_attempts insert)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quiz_event_admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.quiz_events(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_index integer NOT NULL CHECK (room_index >= 0),
  room_id text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(room_id)) > 0),
  normalized_email text,
  device_hash text NOT NULL CHECK (device_hash ~ '^[0-9a-f]{64}$'),
  leaderboard_username text,
  rules_version text NOT NULL,
  terms_accepted_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  app_version text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  integrity_tier text NOT NULL DEFAULT 'unknown',
  check_in_request_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'admitted'
    CHECK (status IN ('admitted', 'revoked', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT quiz_event_admissions_event_merchant_fkey
    FOREIGN KEY (event_id, merchant_id)
    REFERENCES public.quiz_events(id, merchant_id)
    ON DELETE CASCADE,
  CONSTRAINT quiz_event_admissions_event_customer_unique
    UNIQUE (event_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_event_admissions_merchant
  ON public.quiz_event_admissions (merchant_id);
CREATE INDEX IF NOT EXISTS idx_quiz_event_admissions_customer
  ON public.quiz_event_admissions (customer_id);
CREATE INDEX IF NOT EXISTS idx_quiz_event_admissions_user
  ON public.quiz_event_admissions (user_id, event_id);
CREATE INDEX IF NOT EXISTS idx_quiz_event_admissions_event_room
  ON public.quiz_event_admissions (event_id, room_id);
CREATE INDEX IF NOT EXISTS idx_quiz_event_admissions_event_device
  ON public.quiz_event_admissions (event_id, device_hash)
  WHERE status = 'admitted';
CREATE INDEX IF NOT EXISTS idx_quiz_event_admissions_event_email
  ON public.quiz_event_admissions (event_id, merchant_id, normalized_email)
  WHERE status = 'admitted' AND normalized_email IS NOT NULL;

ALTER TABLE public.quiz_event_admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quiz_event_admissions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  event_id,
  merchant_id,
  customer_id,
  user_id,
  room_index,
  room_id,
  leaderboard_username,
  rules_version,
  terms_accepted_at,
  app_version,
  platform,
  integrity_tier,
  check_in_request_id,
  status,
  created_at,
  updated_at
) ON TABLE public.quiz_event_admissions TO authenticated;

DROP POLICY IF EXISTS quiz_event_admissions_customer_read
  ON public.quiz_event_admissions;
CREATE POLICY quiz_event_admissions_customer_read
  ON public.quiz_event_admissions
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.customers AS customer
      WHERE customer.id = customer_id
        AND customer.user_id = (SELECT auth.uid())
        AND customer.deleted_at IS NULL
    )
  );

-- Prevent switching backend_mode after any admission or attempt exists.
CREATE OR REPLACE FUNCTION private.guard_quiz_event_backend_mode_lock_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.backend_mode IS DISTINCT FROM NEW.backend_mode THEN
    IF EXISTS (
      SELECT 1 FROM public.quiz_event_admissions AS adm WHERE adm.event_id = NEW.id
    ) OR EXISTS (
      SELECT 1 FROM public.quiz_attempts AS attempt WHERE attempt.event_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'quiz_backend_mode_locked' USING ERRCODE = 'QZ060';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_quiz_event_backend_mode_lock_v2
  ON public.quiz_events;
CREATE TRIGGER guard_quiz_event_backend_mode_lock_v2
  BEFORE UPDATE OF backend_mode ON public.quiz_events
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_quiz_event_backend_mode_lock_v2();

ALTER FUNCTION private.guard_quiz_event_backend_mode_lock_v2()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_quiz_event_backend_mode_lock_v2()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_in_quiz_event_v2(
  p_event_id uuid,
  p_device_hash text,
  p_accepted_rules_version text,
  p_terms_accepted boolean,
  p_check_in_request_id uuid,
  p_app_version text,
  p_platform text,
  p_integrity_tier text DEFAULT 'unknown',
  p_attestation_nonce_hash text DEFAULT NULL,
  p_attestation_token_hash text DEFAULT NULL,
  p_attestation_token_issued_at timestamptz DEFAULT NULL,
  p_require_attestation boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admitted_count integer;
  v_attestation_ok boolean;
  v_customer public.customers%ROWTYPE;
  v_device_conflict boolean;
  v_email_admissions integer;
  v_event public.quiz_events%ROWTYPE;
  v_existing public.quiz_event_admissions%ROWTYPE;
  v_guard jsonb;
  v_max_entrants integer;
  v_normalized_email text;
  v_now timestamptz;
  v_room_count integer;
  v_room_id text;
  v_room_index integer;
  v_user_id uuid := auth.uid();
  v_admission_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'quiz_event_not_found' USING ERRCODE = 'QZ003';
  END IF;
  IF p_check_in_request_id IS NULL THEN
    RAISE EXCEPTION 'quiz_start_request_required' USING ERRCODE = 'QZ400';
  END IF;
  IF p_device_hash IS NULL OR p_device_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'quiz_device_hash_invalid' USING ERRCODE = 'QZ042';
  END IF;
  IF p_platform NOT IN ('android', 'ios', 'web')
    OR p_app_version IS NULL
    OR pg_catalog.length(pg_catalog.btrim(p_app_version)) = 0 THEN
    RAISE EXCEPTION 'quiz_client_metadata_invalid' USING ERRCODE = 'QZ400';
  END IF;

  SELECT event.*
  INTO v_event
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id
  FOR SHARE;

  v_now := pg_catalog.clock_timestamp();

  IF v_event.id IS NULL OR v_event.contract_version <> 2 THEN
    RAISE EXCEPTION 'quiz_event_not_found' USING ERRCODE = 'QZ003';
  END IF;
  IF v_event.backend_mode <> 'edge_rooms' THEN
    RAISE EXCEPTION 'quiz_backend_mode_mismatch' USING ERRCODE = 'QZ062';
  END IF;
  IF v_event.status NOT IN ('scheduled', 'active')
    OR v_event.starts_at IS NULL
    OR v_event.ends_at IS NULL
    OR v_event.ends_at <= v_now THEN
    RAISE EXCEPTION 'quiz_event_not_open' USING ERRCODE = 'QZ002';
  END IF;

  v_guard := public.get_quiz_start_guard_context_v2(p_event_id);
  IF COALESCE((v_guard ->> 'found')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'quiz_event_not_available' USING ERRCODE = 'QZ003';
  END IF;

  IF NOT COALESCE(p_terms_accepted, false)
    OR p_accepted_rules_version IS DISTINCT FROM v_event.rules_version THEN
    RAISE EXCEPTION 'quiz_rules_acceptance_required' USING ERRCODE = 'QZ400';
  END IF;

  SELECT customer.*
  INTO v_customer
  FROM public.customers AS customer
  WHERE customer.user_id = v_user_id
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
  IF v_event.mode = 'live'
    AND v_customer.date_of_birth > (
      (v_now AT TIME ZONE 'UTC')::date - INTERVAL '18 years'
    )::date THEN
    RAISE EXCEPTION 'quiz_age_restricted' USING ERRCODE = 'QZ014';
  END IF;

  v_normalized_email := public.quiz_normalize_email(v_customer.email);

  -- Deterministic lock order prevents deadlocks across concurrent alias/device races.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    ('x' || pg_catalog.substr(
      pg_catalog.md5(v_event.id::text || ':adm-cust:' || v_customer.id::text),
      1, 16
    ))::bit(64)::bigint
  );

  SELECT adm.*
  INTO v_existing
  FROM public.quiz_event_admissions AS adm
  WHERE adm.event_id = v_event.id
    AND adm.customer_id = v_customer.id
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status <> 'admitted' THEN
      RAISE EXCEPTION 'quiz_admission_revoked' USING ERRCODE = 'QZ063';
    END IF;
    IF v_existing.device_hash IS DISTINCT FROM p_device_hash THEN
      RAISE EXCEPTION 'quiz_device_binding_conflict' USING ERRCODE = 'QZ043';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'admissionId', v_existing.id,
      'eventId', v_existing.event_id,
      'merchantId', v_existing.merchant_id,
      'customerId', v_existing.customer_id,
      'userId', v_existing.user_id,
      'roomId', v_existing.room_id,
      'roomIndex', v_existing.room_index,
      'leaderboardUsername', v_existing.leaderboard_username,
      'maxAttempts', v_event.max_attempts,
      'startsAt', v_event.starts_at,
      'endsAt', v_event.ends_at,
      'rulesVersion', v_event.rules_version,
      'reused', true
    );
  END IF;

  -- Optional single-use App Check challenge consumption (20261115120000).
  -- Server routes that already verified/consumed attestation via enforceQuizStartGuards
  -- pass p_require_attestation = false and NULL hashes to avoid double consumption.
  IF p_require_attestation IS TRUE
    OR p_attestation_nonce_hash IS NOT NULL
    OR p_attestation_token_hash IS NOT NULL
    OR p_attestation_token_issued_at IS NOT NULL THEN
    IF p_attestation_nonce_hash IS NULL
      OR p_attestation_token_hash IS NULL
      OR p_attestation_token_issued_at IS NULL THEN
      RAISE EXCEPTION 'quiz_attestation_required' USING ERRCODE = 'QZ048';
    END IF;
    v_attestation_ok := public.consume_quiz_app_attestation_challenge_v1(
      p_event_id,
      p_attestation_nonce_hash,
      p_attestation_token_hash,
      p_attestation_token_issued_at
    );
    IF COALESCE(v_attestation_ok, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'quiz_attestation_invalid' USING ERRCODE = 'QZ049';
    END IF;
  END IF;

  IF v_normalized_email IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      ('x' || pg_catalog.substr(
        pg_catalog.md5(
          v_event.id::text || ':adm-email:' || v_event.merchant_id::text || ':' || v_normalized_email
        ),
        1, 16
      ))::bit(64)::bigint
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    ('x' || pg_catalog.substr(
      pg_catalog.md5(v_event.id::text || ':adm-dev:' || p_device_hash),
      1, 16
    ))::bit(64)::bigint
  );

  -- Optional event-wide entrant cap from settings->>'max_entrants'.
  IF (v_event.settings ->> 'max_entrants') ~ '^[0-9]+$'
    AND (v_event.settings ->> 'max_entrants')::numeric BETWEEN 1 AND 2147483647 THEN
    v_max_entrants := (v_event.settings ->> 'max_entrants')::integer;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      ('x' || pg_catalog.substr(
        pg_catalog.md5(v_event.id::text || ':adm-cap'),
        1, 16
      ))::bit(64)::bigint
    );
    SELECT pg_catalog.count(*)::integer
    INTO v_admitted_count
    FROM public.quiz_event_admissions AS adm
    WHERE adm.event_id = v_event.id
      AND adm.status = 'admitted';
    IF COALESCE(v_admitted_count, 0) >= v_max_entrants THEN
      RAISE EXCEPTION 'quiz_event_entrant_cap_reached' USING ERRCODE = 'QZ069';
    END IF;
  END IF;

  -- Normalized-email alias cap across active merchant customers.
  IF v_normalized_email IS NOT NULL THEN
    SELECT pg_catalog.count(*)::integer
    INTO v_email_admissions
    FROM public.customers AS customer
    JOIN public.quiz_event_admissions AS adm
      ON adm.event_id = v_event.id
     AND adm.customer_id = customer.id
    WHERE customer.merchant_id = v_event.merchant_id
      AND public.quiz_normalize_email(customer.email) = v_normalized_email
      AND customer.deleted_at IS NULL
      AND adm.status = 'admitted'
      AND adm.customer_id <> v_customer.id;

    IF COALESCE(v_email_admissions, 0) = 0 THEN
      SELECT pg_catalog.count(*)::integer
      INTO v_email_admissions
      FROM public.quiz_event_admissions AS adm
      WHERE adm.event_id = v_event.id
        AND adm.merchant_id = v_event.merchant_id
        AND adm.normalized_email = v_normalized_email
        AND adm.status = 'admitted'
        AND adm.customer_id <> v_customer.id;
    END IF;

    IF COALESCE(v_email_admissions, 0) > 0 THEN
      RAISE EXCEPTION 'quiz_identity_attempt_limit' USING ERRCODE = 'QZ040';
    END IF;
  END IF;

  -- Cross-account device cap (one customer per device per event).
  SELECT EXISTS (
    SELECT 1
    FROM public.quiz_event_admissions AS adm
    WHERE adm.event_id = v_event.id
      AND adm.device_hash = p_device_hash
      AND adm.status = 'admitted'
      AND adm.customer_id <> v_customer.id
  )
  INTO v_device_conflict;

  IF COALESCE(v_device_conflict, false) THEN
    RAISE EXCEPTION 'quiz_device_limit_reached' USING ERRCODE = 'QZ041';
  END IF;

  v_room_count := GREATEST(COALESCE(v_event.expected_room_count, 1), 1);
  v_room_index := pg_catalog.abs(
    pg_catalog.hashtextextended(v_event.id::text || ':' || v_customer.id::text, 0)
  ) % v_room_count;
  v_room_id := 'quiz-room:' || v_event.id::text || ':' || v_room_index::text;

  INSERT INTO public.quiz_event_admissions (
    event_id,
    merchant_id,
    customer_id,
    user_id,
    room_index,
    room_id,
    normalized_email,
    device_hash,
    leaderboard_username,
    rules_version,
    terms_accepted_at,
    app_version,
    platform,
    integrity_tier,
    check_in_request_id
  ) VALUES (
    v_event.id,
    v_event.merchant_id,
    v_customer.id,
    v_user_id,
    v_room_index,
    v_room_id,
    v_normalized_email,
    p_device_hash,
    pg_catalog.btrim(v_customer.username),
    v_event.rules_version,
    v_now,
    pg_catalog.btrim(p_app_version),
    p_platform,
    COALESCE(NULLIF(pg_catalog.btrim(p_integrity_tier), ''), 'unknown'),
    p_check_in_request_id
  )
  RETURNING id INTO v_admission_id;

  RETURN pg_catalog.jsonb_build_object(
    'admissionId', v_admission_id,
    'eventId', v_event.id,
    'merchantId', v_event.merchant_id,
    'customerId', v_customer.id,
    'userId', v_user_id,
    'roomId', v_room_id,
    'roomIndex', v_room_index,
    'leaderboardUsername', pg_catalog.btrim(v_customer.username),
    'maxAttempts', v_event.max_attempts,
    'startsAt', v_event.starts_at,
    'endsAt', v_event.ends_at,
    'rulesVersion', v_event.rules_version,
    'reused', false
  );
END;
$$;

ALTER FUNCTION public.check_in_quiz_event_v2(
  uuid, text, text, boolean, uuid, text, text, text, text, text, timestamptz, boolean
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_in_quiz_event_v2(
  uuid, text, text, boolean, uuid, text, text, text, text, text, timestamptz, boolean
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.check_in_quiz_event_v2(
  uuid, text, text, boolean, uuid, text, text, text, text, text, timestamptz, boolean
) TO authenticated;

-- Prevent legacy SQL start path from running on edge_rooms events.
DO $patch_start$
DECLARE
  v_def text;
  v_anchor text := '  IF v_event.mode = ''live'' AND NOT p_allow_live THEN';
  v_insert text := '  IF v_event.backend_mode <> ''postgres'' THEN
    RAISE EXCEPTION ''quiz_backend_mode_mismatch'' USING ERRCODE = ''QZ062'';
  END IF;
  IF v_event.mode = ''live'' AND NOT p_allow_live THEN';
BEGIN
  v_def := pg_catalog.pg_get_functiondef(
    'private.start_quiz_attempt_v2_core(uuid,text,text,boolean,uuid,text,text,jsonb,uuid,boolean)'::regprocedure
  );
  IF pg_catalog.strpos(v_def, 'quiz_backend_mode_mismatch') = 0 THEN
    IF pg_catalog.strpos(v_def, v_anchor) = 0 THEN
      RAISE EXCEPTION 'Unexpected start_quiz_attempt_v2_core definition';
    END IF;
    EXECUTE pg_catalog.replace(v_def, v_anchor, v_insert);
  END IF;
END $patch_start$;

-- ---------------------------------------------------------------------------
-- 3. Trigger isolation for edge_rooms canonical writes (legacy unchanged)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.quiz_enforce_identity_attempt_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_backend_mode text;
  v_identity text;
  v_merchant_id uuid;
  v_max_attempts integer;
  v_identity_attempts integer;
BEGIN
  IF NEW.backend_mode = 'edge_rooms' THEN
    RETURN NEW;
  END IF;

  SELECT event.backend_mode
  INTO v_backend_mode
  FROM public.quiz_events AS event
  WHERE event.id = NEW.event_id;

  IF v_backend_mode = 'edge_rooms' THEN
    RETURN NEW;
  END IF;

  SELECT public.quiz_normalize_email(c.email), c.merchant_id
  INTO v_identity, v_merchant_id
  FROM public.customers c
  WHERE c.id = NEW.customer_id;

  IF v_identity IS NULL OR v_merchant_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    ('x' || pg_catalog.substr(
      pg_catalog.md5(
        NEW.event_id::text || ':' || v_merchant_id::text || ':' || v_identity
      ),
      1,
      16
    ))::bit(64)::bigint
  );

  v_max_attempts := COALESCE(public.quiz_event_max_attempts(NEW.event_id), 3);

  SELECT pg_catalog.count(*)::integer
  INTO v_identity_attempts
  FROM public.quiz_attempts a
  JOIN public.customers c ON c.id = a.customer_id
  WHERE a.event_id = NEW.event_id
    AND c.merchant_id = v_merchant_id
    AND public.quiz_normalize_email(c.email) = v_identity;

  IF COALESCE(v_identity_attempts, 0) >= v_max_attempts THEN
    RAISE EXCEPTION 'quiz_identity_attempt_limit'
      USING ERRCODE = 'QZ040';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.quiz_enforce_identity_attempt_cap() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.quiz_enforce_identity_attempt_cap()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_enforce_identity_attempt_cap()
  TO service_role;

DROP TRIGGER IF EXISTS quiz_attempts_enforce_identity_cap ON public.quiz_attempts;
CREATE TRIGGER quiz_attempts_enforce_identity_cap
  BEFORE INSERT ON public.quiz_attempts
  FOR EACH ROW
  WHEN (NEW.backend_mode = 'postgres')
  EXECUTE FUNCTION public.quiz_enforce_identity_attempt_cap();

CREATE OR REPLACE FUNCTION private.accumulate_quiz_attempt_score_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.answer_payload ? 'edge_room' THEN
    RETURN NEW;
  END IF;

  UPDATE public.quiz_attempts AS attempt
  SET score = COALESCE(attempt.score, 0) + COALESCE(NEW.score_delta, 0)
  FROM public.quiz_attempt_questions AS question, public.quiz_events AS event
  WHERE question.id = NEW.attempt_question_id
    AND attempt.id = question.attempt_id
    AND event.id = attempt.event_id
    AND event.contract_version = 2
    AND event.backend_mode = 'postgres';
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
  FOR EACH ROW
  WHEN (NOT (NEW.answer_payload ? 'edge_room'))
  EXECUTE FUNCTION private.accumulate_quiz_attempt_score_v2();

CREATE OR REPLACE FUNCTION private.refresh_quiz_live_standing_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_backend_mode text;
  v_elapsed bigint;
BEGIN
  IF NEW.backend_mode = 'edge_rooms' THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('submitted', 'scored') OR NEW.submitted_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT event.backend_mode
  INTO v_backend_mode
  FROM public.quiz_events AS event
  WHERE event.id = NEW.event_id;

  IF v_backend_mode = 'edge_rooms' THEN
    RETURN NEW;
  END IF;

  v_elapsed := pg_catalog.floor(
    EXTRACT(EPOCH FROM (NEW.submitted_at - NEW.started_at)) * 1000
  )::bigint;
  INSERT INTO public.quiz_live_standings_v2 (
    event_id, customer_id, attempt_id, score, total_time_milliseconds,
    submitted_at, leaderboard_username, attempt_status, updated_at
  )
  VALUES (
    NEW.event_id, NEW.customer_id, NEW.id, COALESCE(NEW.score, 0), v_elapsed,
    NEW.submitted_at, NEW.leaderboard_username, NEW.status, pg_catalog.now()
  )
  ON CONFLICT (event_id, customer_id) DO UPDATE
  SET attempt_id = EXCLUDED.attempt_id,
      score = EXCLUDED.score,
      total_time_milliseconds = EXCLUDED.total_time_milliseconds,
      submitted_at = EXCLUDED.submitted_at,
      leaderboard_username = EXCLUDED.leaderboard_username,
      attempt_status = EXCLUDED.attempt_status,
      updated_at = pg_catalog.now()
  WHERE (EXCLUDED.score, -EXCLUDED.total_time_milliseconds, -EXTRACT(EPOCH FROM EXCLUDED.submitted_at), EXCLUDED.attempt_id::text)
      > (quiz_live_standings_v2.score, -quiz_live_standings_v2.total_time_milliseconds, -EXTRACT(EPOCH FROM quiz_live_standings_v2.submitted_at), quiz_live_standings_v2.attempt_id::text);
  RETURN NEW;
END;
$$;

ALTER FUNCTION private.refresh_quiz_live_standing_v2() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.refresh_quiz_live_standing_v2()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_quiz_live_standing_v2 ON public.quiz_attempts;
CREATE TRIGGER trg_quiz_live_standing_v2
  AFTER INSERT OR UPDATE OF status, score, submitted_at ON public.quiz_attempts
  FOR EACH ROW
  WHEN (NEW.backend_mode = 'postgres')
  EXECUTE FUNCTION private.refresh_quiz_live_standing_v2();

-- ---------------------------------------------------------------------------
-- 4. Private raw staging, room seals & scoring run tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.quiz_edge_attempt_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.quiz_events(id) ON DELETE CASCADE,
  room_id text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(room_id)) > 0),
  batch_id text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(batch_id)) > 0),
  part_index integer NOT NULL DEFAULT 0 CHECK (part_index >= 0),
  total_parts integer NOT NULL DEFAULT 1 CHECK (total_parts >= 1 AND part_index < total_parts),
  batch_checksum_sha256 text NOT NULL CHECK (batch_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  attempt_count integer NOT NULL CHECK (attempt_count >= 0),
  answer_count integer NOT NULL CHECK (answer_count >= 0),
  received_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  scored_at timestamptz,
  scored_attempt_count integer CHECK (scored_attempt_count IS NULL OR scored_attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (event_id, room_id, batch_id, part_index)
);

ALTER TABLE private.quiz_edge_attempt_batches
  ADD COLUMN IF NOT EXISTS scored_at timestamptz,
  ADD COLUMN IF NOT EXISTS scored_attempt_count integer;

CREATE INDEX IF NOT EXISTS idx_quiz_edge_attempt_batches_event_room
  ON private.quiz_edge_attempt_batches (event_id, room_id);
CREATE INDEX IF NOT EXISTS idx_quiz_edge_attempt_batches_unscored
  ON private.quiz_edge_attempt_batches (event_id, received_at, id)
  WHERE scored_at IS NULL;

CREATE TABLE IF NOT EXISTS private.quiz_edge_attempt_staging (
  event_id uuid NOT NULL REFERENCES public.quiz_events(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL,
  admission_id uuid REFERENCES public.quiz_event_admissions(id) ON DELETE SET NULL,
  room_id text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(room_id)) > 0),
  batch_id text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(batch_id)) > 0),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  attempt_number integer NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  integrity_tier text NOT NULL DEFAULT 'unknown',
  leaderboard_username text,
  rules_version text,
  terms_accepted_at timestamptz,
  app_version text,
  platform text CHECK (platform IS NULL OR platform IN ('android', 'ios', 'web')),
  start_request_id uuid,
  started_at timestamptz NOT NULL,
  submitted_at timestamptz,
  close_reason text NOT NULL
    CHECK (close_reason IN ('completed', 'event_closed', 'event_ended', 'event_cancelled', 'disqualified', 'tester_revoked')),
  bundle_checksum_sha256 text NOT NULL CHECK (bundle_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  answers jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (pg_catalog.jsonb_typeof(answers) = 'array'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (event_id, attempt_id),
  UNIQUE (event_id, customer_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_quiz_edge_attempt_staging_room
  ON private.quiz_edge_attempt_staging (event_id, room_id);
CREATE INDEX IF NOT EXISTS idx_quiz_edge_attempt_staging_event_room_batch
  ON private.quiz_edge_attempt_staging (event_id, room_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_quiz_edge_attempt_staging_admission
  ON private.quiz_edge_attempt_staging (admission_id)
  WHERE admission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quiz_edge_attempt_staging_customer
  ON private.quiz_edge_attempt_staging (customer_id);

CREATE TABLE IF NOT EXISTS private.quiz_edge_room_seals (
  event_id uuid NOT NULL REFERENCES public.quiz_events(id) ON DELETE CASCADE,
  room_id text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(room_id)) > 0),
  persisted_close_at timestamptz NOT NULL,
  event_status text NOT NULL CHECK (event_status IN ('completed', 'cancelled')),
  attempt_count integer NOT NULL CHECK (attempt_count >= 0),
  answer_count integer NOT NULL CHECK (answer_count >= 0),
  batch_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  batch_count integer NOT NULL CHECK (batch_count >= 0),
  room_checksum_sha256 text NOT NULL CHECK (room_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  sealed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (event_id, room_id),
  CHECK (pg_catalog.cardinality(batch_ids) = batch_count)
);

CREATE TABLE IF NOT EXISTS private.quiz_edge_scoring_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.quiz_events(id) ON DELETE CASCADE,
  manifest_checksum_sha256 text NOT NULL CHECK (manifest_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  persisted_close_at timestamptz NOT NULL,
  expected_rooms integer NOT NULL CHECK (expected_rooms >= 0),
  sealed_rooms integer NOT NULL CHECK (sealed_rooms >= 0),
  total_batches integer NOT NULL CHECK (total_batches >= 0),
  total_attempts integer NOT NULL CHECK (total_attempts >= 0),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  attempts_written integer NOT NULL DEFAULT 0,
  questions_written integer NOT NULL DEFAULT 0,
  answers_written integer NOT NULL DEFAULT 0,
  results_written integer NOT NULL DEFAULT 0,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_quiz_edge_scoring_runs_event_status
  ON private.quiz_edge_scoring_runs (event_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS private.quiz_edge_scored_attempts (
  event_id uuid NOT NULL REFERENCES public.quiz_events(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL,
  room_id text NOT NULL,
  batch_id text NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  attempt_number integer NOT NULL,
  integrity_tier text NOT NULL,
  leaderboard_username text,
  rules_version text,
  terms_accepted_at timestamptz,
  app_version text,
  platform text,
  start_request_id uuid,
  started_at timestamptz NOT NULL,
  submitted_at timestamptz,
  close_reason text NOT NULL,
  score integer NOT NULL CHECK (score >= 0),
  scored_status text NOT NULL,
  canonical_answers_backfilled_at timestamptz,
  scored_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (event_id, attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_edge_scored_attempts_event_batch
  ON private.quiz_edge_scored_attempts (event_id, room_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_quiz_edge_scored_attempts_backfill
  ON private.quiz_edge_scored_attempts (event_id, attempt_id)
  WHERE canonical_answers_backfilled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quiz_edge_scored_attempts_customer
  ON private.quiz_edge_scored_attempts (customer_id)
  WHERE customer_id IS NOT NULL;

ALTER TABLE private.quiz_edge_attempt_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.quiz_edge_attempt_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.quiz_edge_room_seals ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.quiz_edge_scoring_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.quiz_edge_scored_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  private.quiz_edge_attempt_batches,
  private.quiz_edge_attempt_staging,
  private.quiz_edge_room_seals,
  private.quiz_edge_scoring_runs,
  private.quiz_edge_scored_attempts
FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Restricted batch consumer role (zero direct table privileges)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quiz_edge_batch_worker') THEN
    CREATE ROLE quiz_edge_batch_worker NOLOGIN NOINHERIT NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE quiz_edge_batch_worker NOLOGIN CONNECTION LIMIT -1 PASSWORD NULL;
REVOKE ALL ON SCHEMA private FROM quiz_edge_batch_worker;
GRANT USAGE ON SCHEMA public TO quiz_edge_batch_worker;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    GRANT quiz_edge_batch_worker TO authenticator;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Manifest reconciliation helper & Two-Fact Publication Gate helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.quiz_edge_reconciliation_snapshot_v2(
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admitted_room_count integer := 0;
  v_batch_count_mismatches integer := 0;
  v_close_mismatch_count integer := 0;
  v_completed_run_valid boolean := false;
  v_event public.quiz_events%ROWTYPE;
  v_incomplete_batch_parts integer := 0;
  v_manifest_checksum text;
  v_missing_batches jsonb := '[]'::jsonb;
  v_missing_rooms jsonb := '[]'::jsonb;
  v_reconciled boolean := false;
  v_sealed_room_count integer := 0;
BEGIN
  SELECT event.*
  INTO v_event
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id;

  IF v_event.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'found', false,
      'manifestReconciled', false,
      'readyForPublication', false
    );
  END IF;

  SELECT pg_catalog.count(DISTINCT adm.room_id)::integer
  INTO v_admitted_room_count
  FROM public.quiz_event_admissions AS adm
  WHERE adm.event_id = p_event_id
    AND adm.status = 'admitted';

  SELECT pg_catalog.count(*)::integer
  INTO v_sealed_room_count
  FROM private.quiz_edge_room_seals AS seal
  WHERE seal.event_id = p_event_id;

  -- Expected rooms from admissions AND any room that sent batches/staging.
  WITH expected_rooms AS (
    SELECT DISTINCT adm.room_id
    FROM public.quiz_event_admissions AS adm
    WHERE adm.event_id = p_event_id
      AND adm.status = 'admitted'
    UNION
    SELECT DISTINCT batch.room_id
    FROM private.quiz_edge_attempt_batches AS batch
    WHERE batch.event_id = p_event_id
    UNION
    SELECT DISTINCT staged.room_id
    FROM private.quiz_edge_attempt_staging AS staged
    WHERE staged.event_id = p_event_id
  )
  SELECT COALESCE(
    pg_catalog.jsonb_agg(er.room_id ORDER BY er.room_id),
    '[]'::jsonb
  )
  INTO v_missing_rooms
  FROM expected_rooms AS er
  WHERE NOT EXISTS (
    SELECT 1
    FROM private.quiz_edge_room_seals AS seal
    WHERE seal.event_id = p_event_id
      AND seal.room_id = er.room_id
  );

  -- Batches declared in seals but missing or incomplete in quiz_edge_attempt_batches.
  WITH declared AS (
    SELECT seal.room_id, batch_id
    FROM private.quiz_edge_room_seals AS seal
    CROSS JOIN LATERAL pg_catalog.unnest(seal.batch_ids) AS batch_id
    WHERE seal.event_id = p_event_id
  )
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('roomId', d.room_id, 'batchId', d.batch_id)
      ORDER BY d.room_id, d.batch_id
    ),
    '[]'::jsonb
  )
  INTO v_missing_batches
  FROM declared AS d
  WHERE NOT EXISTS (
    SELECT 1
    FROM private.quiz_edge_attempt_batches AS b
    WHERE b.event_id = p_event_id
      AND b.room_id = d.room_id
      AND b.batch_id = d.batch_id
  );

  SELECT pg_catalog.count(*)::integer
  INTO v_incomplete_batch_parts
  FROM (
    SELECT b.room_id, b.batch_id
    FROM private.quiz_edge_attempt_batches AS b
    WHERE b.event_id = p_event_id
    GROUP BY b.room_id, b.batch_id
    HAVING pg_catalog.count(*) <> pg_catalog.max(b.total_parts)
  ) AS incomplete;

  -- Verify batch counts and staged attempt counts match every room seal.
  WITH room_actual AS (
    SELECT
      seal.room_id,
      seal.attempt_count AS seal_attempts,
      seal.batch_count AS seal_batches,
      seal.persisted_close_at AS seal_close_at,
      seal.answer_count AS seal_answers,
      (
        SELECT pg_catalog.count(DISTINCT b.batch_id)::integer
        FROM private.quiz_edge_attempt_batches AS b
        WHERE b.event_id = p_event_id AND b.room_id = seal.room_id
      ) AS actual_batches,
      (
        SELECT pg_catalog.count(*)::integer
        FROM private.quiz_edge_attempt_staging AS s
        WHERE s.event_id = p_event_id AND s.room_id = seal.room_id
      ) AS actual_attempts,
      (
        SELECT COALESCE(pg_catalog.sum(pg_catalog.jsonb_array_length(s.answers)), 0)::integer
        FROM private.quiz_edge_attempt_staging AS s
        WHERE s.event_id = p_event_id AND s.room_id = seal.room_id
      ) AS actual_answers
    FROM private.quiz_edge_room_seals AS seal
    WHERE seal.event_id = p_event_id
  )
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE actual_batches <> seal_batches
         OR actual_attempts <> seal_attempts
         OR actual_answers <> seal_answers
    )::integer,
    pg_catalog.count(*) FILTER (
      WHERE v_event.edge_persisted_close_at IS NULL
         OR seal_close_at IS DISTINCT FROM v_event.edge_persisted_close_at
    )::integer
  INTO v_batch_count_mismatches, v_close_mismatch_count
  FROM room_actual;

  SELECT pg_catalog.encode(
    extensions.digest(
      COALESCE(
        (
          SELECT pg_catalog.string_agg(
            seal.room_id || ':' || seal.room_checksum_sha256 || ':'
              || seal.attempt_count::text || ':' || seal.answer_count::text,
            '|' ORDER BY seal.room_id
          )
          FROM private.quiz_edge_room_seals AS seal
          WHERE seal.event_id = p_event_id
        ),
        'empty'
      ),
      'sha256'
    ),
    'hex'
  )
  INTO v_manifest_checksum;

  v_reconciled :=
    v_event.contract_version = 2
    AND v_event.backend_mode = 'edge_rooms'
    AND v_event.edge_persisted_close_at IS NOT NULL
    AND pg_catalog.jsonb_array_length(v_missing_rooms) = 0
    AND pg_catalog.jsonb_array_length(v_missing_batches) = 0
    AND v_incomplete_batch_parts = 0
    AND v_batch_count_mismatches = 0
    AND v_close_mismatch_count = 0
    AND (
      v_event.expected_room_count IS NULL
      OR v_sealed_room_count = v_event.expected_room_count
    );

  IF v_reconciled
    AND v_event.edge_completed_scoring_run_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM private.quiz_edge_scoring_runs AS run
      WHERE run.id = v_event.edge_completed_scoring_run_id
        AND run.event_id = p_event_id
        AND run.status = 'completed'
        AND run.completed_at IS NOT NULL
        AND run.manifest_checksum_sha256 = v_manifest_checksum
        AND run.persisted_close_at = v_event.edge_persisted_close_at
    )
    INTO v_completed_run_valid;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'found', true,
    'eventId', v_event.id,
    'backendMode', v_event.backend_mode,
    'eventStatus', v_event.status,
    'expectedRoomCount', v_event.expected_room_count,
    'admittedRoomCount', v_admitted_room_count,
    'sealedRoomCount', v_sealed_room_count,
    'missingRooms', v_missing_rooms,
    'missingBatches', v_missing_batches,
    'incompleteBatchParts', v_incomplete_batch_parts,
    'countMismatches', v_batch_count_mismatches,
    'closeTimestampMismatches', v_close_mismatch_count,
    'persistedCloseAt', v_event.edge_persisted_close_at,
    'manifestChecksumSha256', v_manifest_checksum,
    'completedScoringRunId', v_event.edge_completed_scoring_run_id,
    'manifestReconciled', v_reconciled,
    'readyForPublication', v_reconciled AND COALESCE(v_completed_run_valid, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.quiz_edge_event_ready_for_publication_v2(
  p_event_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (private.quiz_edge_reconciliation_snapshot_v2(p_event_id) ->> 'readyForPublication')::boolean,
    false
  );
$$;

ALTER FUNCTION private.quiz_edge_reconciliation_snapshot_v2(uuid)
  OWNER TO postgres;
ALTER FUNCTION private.quiz_edge_event_ready_for_publication_v2(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  private.quiz_edge_reconciliation_snapshot_v2(uuid),
  private.quiz_edge_event_ready_for_publication_v2(uuid)
FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Restricted worker RPCs (EXECUTE granted ONLY to quiz_edge_batch_worker)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_quiz_edge_attempt_batch_v2(
  p_event_id uuid,
  p_room_id text,
  p_batch_id text,
  p_batch_checksum_sha256 text,
  p_attempt_count integer,
  p_answer_count integer,
  p_attempts jsonb,
  p_part_index integer DEFAULT 0,
  p_total_parts integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempts_inserted integer := 0;
  v_backend_mode text;
  v_batch_row_count integer := 0;
  v_existing_checksum text;
  v_existing_part_count integer;
  v_part record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'quiz_edge_batch_worker' THEN
    RAISE EXCEPTION 'quiz edge batch worker capability required'
      USING ERRCODE = '42501';
  END IF;

  IF p_event_id IS NULL
    OR NULLIF(pg_catalog.btrim(p_room_id), '') IS NULL
    OR NULLIF(pg_catalog.btrim(p_batch_id), '') IS NULL
    OR p_batch_checksum_sha256 IS NULL
    OR p_batch_checksum_sha256 !~ '^[0-9a-f]{64}$'
    OR p_attempt_count IS NULL OR p_attempt_count < 0
    OR p_answer_count IS NULL OR p_answer_count < 0
    OR p_part_index IS NULL OR p_part_index < 0
    OR p_total_parts IS NULL OR p_total_parts < 1
    OR p_part_index >= p_total_parts
    OR p_attempts IS NULL
    OR pg_catalog.jsonb_typeof(p_attempts) <> 'array' THEN
    RAISE EXCEPTION 'invalid_quiz_edge_batch_payload' USING ERRCODE = '22023';
  END IF;

  SELECT event.backend_mode
  INTO v_backend_mode
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id
  FOR SHARE;

  IF v_backend_mode IS NULL THEN
    RAISE EXCEPTION 'quiz_event_not_found' USING ERRCODE = 'QZ003';
  END IF;
  IF v_backend_mode <> 'edge_rooms' THEN
    RAISE EXCEPTION 'quiz_backend_mode_mismatch' USING ERRCODE = 'QZ062';
  END IF;

  IF p_total_parts = 1 AND pg_catalog.jsonb_array_length(p_attempts) <> p_attempt_count THEN
    RAISE EXCEPTION 'quiz_batch_attempt_count_mismatch' USING ERRCODE = 'QZ066';
  END IF;

  INSERT INTO private.quiz_edge_attempt_batches (
    event_id,
    room_id,
    batch_id,
    part_index,
    total_parts,
    batch_checksum_sha256,
    attempt_count,
    answer_count
  ) VALUES (
    p_event_id,
    pg_catalog.btrim(p_room_id),
    pg_catalog.btrim(p_batch_id),
    p_part_index,
    p_total_parts,
    p_batch_checksum_sha256,
    p_attempt_count,
    p_answer_count
  )
  ON CONFLICT (event_id, room_id, batch_id, part_index) DO NOTHING;

  GET DIAGNOSTICS v_batch_row_count = ROW_COUNT;

  IF v_batch_row_count = 0 THEN
    SELECT b.batch_checksum_sha256, b.total_parts
    INTO v_existing_checksum, v_existing_part_count
    FROM private.quiz_edge_attempt_batches AS b
    WHERE b.event_id = p_event_id
      AND b.room_id = pg_catalog.btrim(p_room_id)
      AND b.batch_id = pg_catalog.btrim(p_batch_id)
      AND b.part_index = p_part_index;

    IF v_existing_checksum IS DISTINCT FROM p_batch_checksum_sha256
      OR v_existing_part_count IS DISTINCT FROM p_total_parts THEN
      RAISE EXCEPTION 'quiz_batch_checksum_mismatch' USING ERRCODE = 'QZ066';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'ingested', false,
      'duplicate', true,
      'attemptsInserted', 0
    );
  END IF;

  IF p_total_parts = 1 THEN
    INSERT INTO private.quiz_edge_attempt_staging (
      event_id,
      attempt_id,
      admission_id,
      room_id,
      batch_id,
      customer_id,
      attempt_number,
      integrity_tier,
      leaderboard_username,
      rules_version,
      terms_accepted_at,
      app_version,
      platform,
      start_request_id,
      started_at,
      submitted_at,
      close_reason,
      bundle_checksum_sha256,
      answers
    )
    SELECT
      p_event_id,
      item.attempt_id,
      adm.id,
      pg_catalog.btrim(p_room_id),
      pg_catalog.btrim(p_batch_id),
      cust.id,
      COALESCE(item.attempt_number, 1),
      COALESCE(NULLIF(pg_catalog.btrim(item.integrity_tier), ''), 'unknown'),
      item.leaderboard_username,
      item.rules_version,
      item.terms_accepted_at,
      item.app_version,
      item.platform,
      item.start_request_id,
      item.started_at,
      item.submitted_at,
      item.close_reason,
      item.bundle_checksum_sha256,
      COALESCE(item.answers, '[]'::jsonb)
    FROM pg_catalog.jsonb_to_recordset(p_attempts) AS item(
      attempt_id uuid,
      admission_id uuid,
      customer_id uuid,
      attempt_number integer,
      integrity_tier text,
      leaderboard_username text,
      rules_version text,
      terms_accepted_at timestamptz,
      app_version text,
      platform text,
      start_request_id uuid,
      started_at timestamptz,
      submitted_at timestamptz,
      close_reason text,
      bundle_checksum_sha256 text,
      answers jsonb
    )
    LEFT JOIN public.customers AS cust
      ON cust.id = item.customer_id
    LEFT JOIN public.quiz_event_admissions AS adm
      ON adm.id = item.admission_id
    ON CONFLICT (event_id, attempt_id) DO UPDATE
    SET answers = (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(dedup.elem ORDER BY (dedup.elem ->> 'position')::integer),
        '[]'::jsonb
      )
      FROM (
        SELECT DISTINCT ON ((elem ->> 'position')::integer) elem
        FROM pg_catalog.jsonb_array_elements(
          private.quiz_edge_attempt_staging.answers || EXCLUDED.answers
        ) AS elem
      ) AS dedup
    ),
    submitted_at = COALESCE(
      private.quiz_edge_attempt_staging.submitted_at,
      EXCLUDED.submitted_at
    );

    GET DIAGNOSTICS v_attempts_inserted = ROW_COUNT;

    -- If any merged attempt belonged to an earlier already-scored batch (e.g.
    -- multi-part split bundle arriving across physical batches), invalidate
    -- that batch's scored_at so incremental/final scoring re-scores the merged answers.
    UPDATE private.quiz_edge_attempt_batches AS b
    SET scored_at = NULL,
        scored_attempt_count = NULL
    WHERE b.event_id = p_event_id
      AND b.room_id = pg_catalog.btrim(p_room_id)
      AND b.scored_at IS NOT NULL
      AND b.batch_id IN (
        SELECT s.batch_id
        FROM private.quiz_edge_attempt_staging AS s
        WHERE s.event_id = p_event_id
          AND s.attempt_id IN (
            SELECT (elem ->> 'attempt_id')::uuid
            FROM pg_catalog.jsonb_array_elements(p_attempts) AS elem
          )
      );
  ELSE
    -- Multi-part split bundle path: merge answer arrays deduplicated by position.
    FOR v_part IN
      SELECT
        item.attempt_id,
        adm.id AS admission_id,
        cust.id AS customer_id,
        item.attempt_number,
        item.integrity_tier,
        item.leaderboard_username,
        item.rules_version,
        item.terms_accepted_at,
        item.app_version,
        item.platform,
        item.start_request_id,
        item.started_at,
        item.submitted_at,
        item.close_reason,
        item.bundle_checksum_sha256,
        item.answers
      FROM pg_catalog.jsonb_to_recordset(p_attempts) AS item(
        attempt_id uuid,
        admission_id uuid,
        customer_id uuid,
        attempt_number integer,
        integrity_tier text,
        leaderboard_username text,
        rules_version text,
        terms_accepted_at timestamptz,
        app_version text,
        platform text,
        start_request_id uuid,
        started_at timestamptz,
        submitted_at timestamptz,
        close_reason text,
        bundle_checksum_sha256 text,
        answers jsonb
      )
      LEFT JOIN public.customers AS cust
        ON cust.id = item.customer_id
      LEFT JOIN public.quiz_event_admissions AS adm
        ON adm.id = item.admission_id
    LOOP
      INSERT INTO private.quiz_edge_attempt_staging (
        event_id, attempt_id, admission_id, room_id, batch_id, customer_id,
        attempt_number, integrity_tier, leaderboard_username, rules_version,
        terms_accepted_at, app_version, platform, start_request_id,
        started_at, submitted_at, close_reason, bundle_checksum_sha256, answers
      ) VALUES (
        p_event_id, v_part.attempt_id, v_part.admission_id,
        pg_catalog.btrim(p_room_id), pg_catalog.btrim(p_batch_id),
        v_part.customer_id, COALESCE(v_part.attempt_number, 1),
        COALESCE(NULLIF(pg_catalog.btrim(v_part.integrity_tier), ''), 'unknown'),
        v_part.leaderboard_username, v_part.rules_version,
        v_part.terms_accepted_at, v_part.app_version, v_part.platform,
        v_part.start_request_id, v_part.started_at, v_part.submitted_at,
        v_part.close_reason, v_part.bundle_checksum_sha256,
        COALESCE(v_part.answers, '[]'::jsonb)
      )
      ON CONFLICT (event_id, attempt_id) DO UPDATE
      SET answers = (
        SELECT COALESCE(
          pg_catalog.jsonb_agg(dedup.elem ORDER BY (dedup.elem ->> 'position')::integer),
          '[]'::jsonb
        )
        FROM (
          SELECT DISTINCT ON ((elem ->> 'position')::integer) elem
          FROM pg_catalog.jsonb_array_elements(
            private.quiz_edge_attempt_staging.answers || EXCLUDED.answers
          ) AS elem
        ) AS dedup
      ),
      submitted_at = COALESCE(
        private.quiz_edge_attempt_staging.submitted_at,
        EXCLUDED.submitted_at
      );

      UPDATE private.quiz_edge_attempt_batches
      SET scored_at = NULL,
          scored_attempt_count = NULL
      WHERE event_id = p_event_id
        AND room_id = pg_catalog.btrim(p_room_id)
        AND batch_id = pg_catalog.btrim(p_batch_id)
        AND scored_at IS NOT NULL;

      v_attempts_inserted := v_attempts_inserted + 1;
    END LOOP;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ingested', true,
    'duplicate', false,
    'attemptsInserted', v_attempts_inserted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_quiz_edge_room_seal_v2(
  p_event_id uuid,
  p_room_id text,
  p_persisted_close_at timestamptz,
  p_event_status text,
  p_attempt_count integer,
  p_answer_count integer,
  p_batch_ids text[],
  p_batch_count integer,
  p_room_checksum_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch_ids text[] := COALESCE(p_batch_ids, ARRAY[]::text[]);
  v_event public.quiz_events%ROWTYPE;
  v_existing private.quiz_edge_room_seals%ROWTYPE;
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'quiz_edge_batch_worker' THEN
    RAISE EXCEPTION 'quiz edge batch worker capability required'
      USING ERRCODE = '42501';
  END IF;

  IF p_event_id IS NULL
    OR NULLIF(pg_catalog.btrim(p_room_id), '') IS NULL
    OR p_persisted_close_at IS NULL
    OR p_event_status NOT IN ('completed', 'cancelled')
    OR p_attempt_count IS NULL OR p_attempt_count < 0
    OR p_answer_count IS NULL OR p_answer_count < 0
    OR p_batch_count IS NULL OR p_batch_count < 0
    OR pg_catalog.cardinality(v_batch_ids) <> p_batch_count
    OR p_room_checksum_sha256 IS NULL
    OR p_room_checksum_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_quiz_edge_room_seal' USING ERRCODE = '22023';
  END IF;

  SELECT event.*
  INTO v_event
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id
  FOR UPDATE;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'quiz_event_not_found' USING ERRCODE = 'QZ003';
  END IF;
  IF v_event.backend_mode <> 'edge_rooms' THEN
    RAISE EXCEPTION 'quiz_backend_mode_mismatch' USING ERRCODE = 'QZ062';
  END IF;

  IF v_event.edge_persisted_close_at IS NULL THEN
    UPDATE public.quiz_events
    SET edge_persisted_close_at = p_persisted_close_at,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_event.id;
  ELSIF v_event.edge_persisted_close_at IS DISTINCT FROM p_persisted_close_at THEN
    RAISE EXCEPTION 'quiz_close_timestamp_mismatch' USING ERRCODE = 'QZ067';
  END IF;

  INSERT INTO private.quiz_edge_room_seals (
    event_id,
    room_id,
    persisted_close_at,
    event_status,
    attempt_count,
    answer_count,
    batch_ids,
    batch_count,
    room_checksum_sha256
  ) VALUES (
    p_event_id,
    pg_catalog.btrim(p_room_id),
    p_persisted_close_at,
    p_event_status,
    p_attempt_count,
    p_answer_count,
    v_batch_ids,
    p_batch_count,
    p_room_checksum_sha256
  )
  ON CONFLICT (event_id, room_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    SELECT seal.*
    INTO v_existing
    FROM private.quiz_edge_room_seals AS seal
    WHERE seal.event_id = p_event_id
      AND seal.room_id = pg_catalog.btrim(p_room_id);

    IF v_existing.room_checksum_sha256 IS DISTINCT FROM p_room_checksum_sha256
      OR v_existing.attempt_count IS DISTINCT FROM p_attempt_count
      OR v_existing.answer_count IS DISTINCT FROM p_answer_count
      OR v_existing.batch_count IS DISTINCT FROM p_batch_count
      OR v_existing.persisted_close_at IS DISTINCT FROM p_persisted_close_at THEN
      RAISE EXCEPTION 'quiz_room_seal_conflict' USING ERRCODE = 'QZ064';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'sealed', true,
    'duplicate', v_inserted = 0,
    'roomId', pg_catalog.btrim(p_room_id),
    'persistedCloseAt', p_persisted_close_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_quiz_edge_reconciliation_status_v2(
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'quiz_edge_batch_worker' THEN
    RAISE EXCEPTION 'quiz edge batch worker capability required'
      USING ERRCODE = '42501';
  END IF;

  RETURN private.quiz_edge_reconciliation_snapshot_v2(p_event_id);
END;
$$;

ALTER FUNCTION public.ingest_quiz_edge_attempt_batch_v2(
  uuid, text, text, text, integer, integer, jsonb, integer, integer
) OWNER TO postgres;
ALTER FUNCTION public.record_quiz_edge_room_seal_v2(
  uuid, text, timestamptz, text, integer, integer, text[], integer, text
) OWNER TO postgres;
ALTER FUNCTION public.get_quiz_edge_reconciliation_status_v2(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION
  public.ingest_quiz_edge_attempt_batch_v2(uuid, text, text, text, integer, integer, jsonb, integer, integer),
  public.record_quiz_edge_room_seal_v2(uuid, text, timestamptz, text, integer, integer, text[], integer, text),
  public.get_quiz_edge_reconciliation_status_v2(uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.ingest_quiz_edge_attempt_batch_v2(uuid, text, text, text, integer, integer, jsonb, integer, integer),
  public.record_quiz_edge_room_seal_v2(uuid, text, timestamptz, text, integer, integer, text[], integer, text),
  public.get_quiz_edge_reconciliation_status_v2(uuid)
TO quiz_edge_batch_worker;

-- Note: PostgREST request-scope guard extension for quiz_edge_batch_worker
-- lives in 20261118170001_gigl_quiz_edge_batch_worker_scope.sql.

-- ---------------------------------------------------------------------------
-- 8. Incremental batch pre-scorer, fast close materializer & answer backfill
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.score_quiz_edge_batches_core_v2(
  p_event_id uuid,
  p_limit_batches integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempts_scored integer := 0;
  v_batches_scored integer := 0;
  v_event public.quiz_events%ROWTYPE;
  v_remaining_unscored integer := 0;
BEGIN
  IF p_event_id IS NULL
    OR (p_limit_batches IS NOT NULL AND p_limit_batches < 1) THEN
    RAISE EXCEPTION 'invalid_quiz_edge_scoring_batch_args' USING ERRCODE = '22023';
  END IF;

  SELECT event.*
  INTO v_event
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id
  FOR SHARE;

  IF v_event.id IS NULL OR v_event.contract_version <> 2 THEN
    RAISE EXCEPTION 'quiz_event_not_found' USING ERRCODE = 'QZ003';
  END IF;
  IF v_event.backend_mode <> 'edge_rooms' THEN
    RAISE EXCEPTION 'quiz_backend_mode_mismatch' USING ERRCODE = 'QZ062';
  END IF;

  DROP TABLE IF EXISTS pg_temp._edge_target_batches;
  IF p_limit_batches IS NULL THEN
    CREATE TEMP TABLE _edge_target_batches ON COMMIT DROP AS
    SELECT b.room_id, b.batch_id
    FROM private.quiz_edge_attempt_batches AS b
    WHERE b.event_id = p_event_id
      AND b.scored_at IS NULL
      AND b.part_index = 0
      AND (
        b.total_parts = 1
        OR (
          SELECT pg_catalog.count(*)
          FROM private.quiz_edge_attempt_batches AS b2
          WHERE b2.event_id = p_event_id
            AND b2.room_id = b.room_id
            AND b2.batch_id = b.batch_id
        ) = b.total_parts
      )
    ORDER BY b.received_at, b.id
    FOR UPDATE OF b;
  ELSE
    CREATE TEMP TABLE _edge_target_batches ON COMMIT DROP AS
    SELECT b.room_id, b.batch_id
    FROM private.quiz_edge_attempt_batches AS b
    WHERE b.event_id = p_event_id
      AND b.scored_at IS NULL
      AND b.part_index = 0
      AND (
        b.total_parts = 1
        OR (
          SELECT pg_catalog.count(*)
          FROM private.quiz_edge_attempt_batches AS b2
          WHERE b2.event_id = p_event_id
            AND b2.room_id = b.room_id
            AND b2.batch_id = b.batch_id
        ) = b.total_parts
      )
    ORDER BY b.received_at, b.id
    LIMIT p_limit_batches
    FOR UPDATE OF b SKIP LOCKED;
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_batches_scored
  FROM _edge_target_batches;

  IF v_batches_scored > 0 THEN
    WITH staged_attempts AS (
      SELECT
        s.event_id,
        s.attempt_id,
        s.room_id,
        s.batch_id,
        s.customer_id,
        s.attempt_number,
        s.integrity_tier,
        s.leaderboard_username,
        s.rules_version,
        s.terms_accepted_at,
        s.app_version,
        s.platform,
        s.start_request_id,
        s.started_at,
        s.submitted_at,
        s.close_reason,
        s.answers
      FROM _edge_target_batches AS tb
      JOIN private.quiz_edge_attempt_staging AS s
        ON s.event_id = p_event_id
       AND s.room_id = tb.room_id
       AND s.batch_id = tb.batch_id
    ),
    scored_deltas AS (
      SELECT
        sa.attempt_id,
        pg_catalog.sum(
          CASE
            WHEN v_event.status = 'cancelled' THEN 0
            WHEN COALESCE(ans.timeout, false) THEN 0
            WHEN ans.issued_at IS NULL OR ans.received_at IS NULL THEN 0
            WHEN ans.received_at >= LEAST(
              v_event.ends_at,
              ans.issued_at + pg_catalog.make_interval(
                secs => GREATEST(v_event.time_per_question_seconds, 0)
              )
            ) THEN 0
            WHEN variant.answer_key_hash ~ '^[0-9a-fA-F]{64}$'
              AND (
                CASE
                  WHEN ans.raw_answer IS NOT NULL THEN
                    pg_catalog.encode(
                      extensions.digest(
                        pg_catalog.lower(pg_catalog.btrim(ans.raw_answer)),
                        'sha256'
                      ),
                      'hex'
                    )
                  WHEN ans.selected_answer_hash ~ '^[0-9a-fA-F]{64}$' THEN
                    pg_catalog.lower(ans.selected_answer_hash)
                  ELSE NULL
                END
              ) = pg_catalog.lower(variant.answer_key_hash)
              THEN 1
            ELSE 0
          END
        )::integer AS total_score
      FROM staged_attempts AS sa
      CROSS JOIN LATERAL pg_catalog.jsonb_to_recordset(sa.answers) AS ans(
        slot_id uuid,
        variant_id uuid,
        position integer,
        option_order jsonb,
        issued_at timestamptz,
        received_at timestamptz,
        raw_answer text,
        selected_answer_hash text,
        timeout boolean
      )
      JOIN public.quiz_question_variants AS variant
        ON variant.id = ans.variant_id
      GROUP BY sa.attempt_id
    )
    INSERT INTO private.quiz_edge_scored_attempts (
      event_id,
      attempt_id,
      room_id,
      batch_id,
      customer_id,
      attempt_number,
      integrity_tier,
      leaderboard_username,
      rules_version,
      terms_accepted_at,
      app_version,
      platform,
      start_request_id,
      started_at,
      submitted_at,
      close_reason,
      score,
      scored_status,
      scored_at
    )
    SELECT
      sa.event_id,
      sa.attempt_id,
      sa.room_id,
      sa.batch_id,
      sa.customer_id,
      sa.attempt_number,
      sa.integrity_tier,
      sa.leaderboard_username,
      COALESCE(sa.rules_version, v_event.rules_version),
      sa.terms_accepted_at,
      sa.app_version,
      sa.platform,
      sa.start_request_id,
      sa.started_at,
      sa.submitted_at,
      sa.close_reason,
      COALESCE(sd.total_score, 0),
      CASE
        WHEN v_event.status = 'cancelled' THEN 'event_cancelled'
        WHEN sa.close_reason = 'disqualified' THEN 'disqualified'
        WHEN sa.close_reason = 'tester_revoked' THEN 'tester_revoked'
        WHEN sa.close_reason = 'event_cancelled' THEN 'event_cancelled'
        ELSE 'submitted'
      END,
      pg_catalog.clock_timestamp()
    FROM staged_attempts AS sa
    LEFT JOIN scored_deltas AS sd ON sd.attempt_id = sa.attempt_id
    ORDER BY sa.attempt_id
    ON CONFLICT (event_id, attempt_id) DO UPDATE
    SET score = EXCLUDED.score,
        scored_status = EXCLUDED.scored_status,
        submitted_at = EXCLUDED.submitted_at,
        close_reason = EXCLUDED.close_reason,
        scored_at = pg_catalog.clock_timestamp();

    GET DIAGNOSTICS v_attempts_scored = ROW_COUNT;

    UPDATE private.quiz_edge_attempt_batches AS b
    SET scored_at = pg_catalog.clock_timestamp(),
        scored_attempt_count = COALESCE(
          (
            SELECT pg_catalog.count(*)::integer
            FROM private.quiz_edge_attempt_staging AS s
            WHERE s.event_id = p_event_id
              AND s.room_id = b.room_id
              AND s.batch_id = b.batch_id
          ),
          0
        )
    FROM _edge_target_batches AS tb
    WHERE b.event_id = p_event_id
      AND b.room_id = tb.room_id
      AND b.batch_id = tb.batch_id
      AND b.scored_at IS NULL;
  END IF;

  DROP TABLE IF EXISTS pg_temp._edge_target_batches;

  SELECT pg_catalog.count(*)::integer
  INTO v_remaining_unscored
  FROM private.quiz_edge_attempt_batches AS b
  WHERE b.event_id = p_event_id
    AND b.scored_at IS NULL;

  RETURN pg_catalog.jsonb_build_object(
    'eventId', p_event_id,
    'batchesScored', v_batches_scored,
    'attemptsScored', v_attempts_scored,
    'remainingUnscoredBatches', v_remaining_unscored
  );
END;
$$;

ALTER FUNCTION private.score_quiz_edge_batches_core_v2(uuid, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.score_quiz_edge_batches_core_v2(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.score_quiz_edge_staged_batches_incremental_v2(
  p_event_id uuid,
  p_limit_batches integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := COALESCE(p_limit_batches, 50);
BEGIN
  IF auth.role() IS DISTINCT FROM 'quiz_edge_batch_worker' THEN
    RAISE EXCEPTION 'quiz edge batch worker capability required'
      USING ERRCODE = '42501';
  END IF;

  IF p_event_id IS NULL OR v_limit < 1 OR v_limit > 500 THEN
    RAISE EXCEPTION 'invalid_quiz_edge_incremental_score_args'
      USING ERRCODE = '22023';
  END IF;

  RETURN private.score_quiz_edge_batches_core_v2(p_event_id, v_limit);
END;
$$;

ALTER FUNCTION public.score_quiz_edge_staged_batches_incremental_v2(uuid, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.score_quiz_edge_staged_batches_incremental_v2(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.score_quiz_edge_staged_batches_incremental_v2(uuid, integer)
  TO quiz_edge_batch_worker;

CREATE OR REPLACE FUNCTION private.score_and_materialize_edge_quiz_event_v2(
  p_event_id uuid,
  p_scoring_run_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempts_written integer := 0;
  v_event public.quiz_events%ROWTYPE;
  v_existing_run private.quiz_edge_scoring_runs%ROWTYPE;
  v_manifest_checksum text;
  v_persisted_close_at timestamptz;
  v_reconcile jsonb;
  v_results_written integer := 0;
  v_run_id uuid := COALESCE(p_scoring_run_id, gen_random_uuid());
  v_sealed_rooms integer;
  v_tail_res jsonb;
  v_total_attempts integer;
  v_total_batches integer;
BEGIN
  SELECT event.*
  INTO v_event
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id
  FOR UPDATE;

  IF v_event.id IS NULL OR v_event.contract_version <> 2 THEN
    RAISE EXCEPTION 'quiz_event_not_found' USING ERRCODE = 'QZ003';
  END IF;
  IF v_event.backend_mode <> 'edge_rooms' THEN
    RAISE EXCEPTION 'quiz_backend_mode_mismatch' USING ERRCODE = 'QZ062';
  END IF;

  v_reconcile := private.quiz_edge_reconciliation_snapshot_v2(p_event_id);
  IF COALESCE((v_reconcile ->> 'manifestReconciled')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'quiz_edge_manifest_not_reconciled'
      USING ERRCODE = 'QZ068',
        DETAIL = v_reconcile::text;
  END IF;

  v_manifest_checksum := v_reconcile ->> 'manifestChecksumSha256';
  v_persisted_close_at := v_event.edge_persisted_close_at;
  v_sealed_rooms := COALESCE((v_reconcile ->> 'sealedRoomCount')::integer, 0);

  SELECT
    COALESCE(pg_catalog.sum(seal.batch_count), 0)::integer,
    COALESCE(pg_catalog.sum(seal.attempt_count), 0)::integer
  INTO v_total_batches, v_total_attempts
  FROM private.quiz_edge_room_seals AS seal
  WHERE seal.event_id = p_event_id;

  SELECT run.*
  INTO v_existing_run
  FROM private.quiz_edge_scoring_runs AS run
  WHERE run.id = v_run_id;

  IF v_existing_run.id IS NOT NULL THEN
    IF v_existing_run.event_id IS DISTINCT FROM p_event_id THEN
      RAISE EXCEPTION 'quiz_scoring_run_event_mismatch' USING ERRCODE = '22023';
    END IF;
    IF v_existing_run.event_id = p_event_id
      AND v_existing_run.status = 'completed'
      AND v_existing_run.manifest_checksum_sha256 = v_manifest_checksum THEN
      RETURN pg_catalog.jsonb_build_object(
        'scoringRunId', v_existing_run.id,
        'eventId', p_event_id,
        'reused', true,
        'attemptsWritten', v_existing_run.attempts_written,
        'questionsWritten', v_existing_run.questions_written,
        'answersWritten', v_existing_run.answers_written,
        'resultsWritten', v_existing_run.results_written,
        'canonicalAnswersBackfillDeferred', true
      );
    END IF;
    UPDATE private.quiz_edge_scoring_runs
    SET status = 'running',
        manifest_checksum_sha256 = v_manifest_checksum,
        persisted_close_at = v_persisted_close_at,
        expected_rooms = COALESCE(v_event.expected_room_count, v_sealed_rooms),
        sealed_rooms = v_sealed_rooms,
        total_batches = v_total_batches,
        total_attempts = v_total_attempts,
        error_code = NULL,
        started_at = pg_catalog.clock_timestamp(),
        completed_at = NULL
    WHERE id = v_run_id;
  ELSE
    INSERT INTO private.quiz_edge_scoring_runs (
      id,
      event_id,
      manifest_checksum_sha256,
      persisted_close_at,
      expected_rooms,
      sealed_rooms,
      total_batches,
      total_attempts,
      status
    ) VALUES (
      v_run_id,
      p_event_id,
      v_manifest_checksum,
      v_persisted_close_at,
      COALESCE(v_event.expected_room_count, v_sealed_rooms),
      v_sealed_rooms,
      v_total_batches,
      v_total_attempts,
      'running'
    );
  END IF;

  -- Mark any older stale 'running' runs as failed before materializing.
  UPDATE private.quiz_edge_scoring_runs
  SET status = 'failed',
      error_code = 'superseded'
  WHERE event_id = p_event_id
    AND id <> v_run_id
    AND status = 'running';

  -- Score only remaining unscored tail batches before materializing attempts/results.
  v_tail_res := private.score_quiz_edge_batches_core_v2(p_event_id, NULL);

  INSERT INTO public.quiz_attempts (
    id,
    event_id,
    customer_id,
    status,
    attempt_number,
    integrity_tier,
    score,
    started_at,
    submitted_at,
    leaderboard_username,
    rules_version,
    terms_accepted_at,
    app_version,
    platform,
    start_request_id,
    backend_mode
  )
  SELECT
    sa.attempt_id,
    sa.event_id,
    sa.customer_id,
    CASE
      WHEN v_event.status = 'cancelled' THEN 'event_cancelled'
      ELSE sa.scored_status
    END,
    sa.attempt_number,
    sa.integrity_tier,
    CASE
      WHEN v_event.status = 'cancelled' THEN 0
      ELSE sa.score
    END,
    sa.started_at,
    CASE
      WHEN sa.close_reason = 'completed' AND sa.submitted_at IS NOT NULL
        THEN sa.submitted_at
      ELSE COALESCE(sa.submitted_at, v_persisted_close_at)
    END,
    sa.leaderboard_username,
    COALESCE(sa.rules_version, v_event.rules_version),
    sa.terms_accepted_at,
    sa.app_version,
    sa.platform,
    sa.start_request_id,
    'edge_rooms'
  FROM private.quiz_edge_scored_attempts AS sa
  WHERE sa.event_id = p_event_id
    AND sa.customer_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.customers AS c
      WHERE c.id = sa.customer_id
    )
  ORDER BY sa.attempt_id
  ON CONFLICT (id) DO UPDATE
  SET score = EXCLUDED.score,
      status = EXCLUDED.status,
      submitted_at = EXCLUDED.submitted_at,
      backend_mode = 'edge_rooms'
  WHERE public.quiz_attempts.score IS DISTINCT FROM EXCLUDED.score
     OR public.quiz_attempts.status IS DISTINCT FROM EXCLUDED.status
     OR public.quiz_attempts.submitted_at IS DISTINCT FROM EXCLUDED.submitted_at
     OR public.quiz_attempts.backend_mode IS DISTINCT FROM 'edge_rooms';

  GET DIAGNOSTICS v_attempts_written = ROW_COUNT;

  IF v_event.status = 'cancelled' THEN
    DELETE FROM public.quiz_event_results_v2
    WHERE event_id = p_event_id;
    v_results_written := 0;
  ELSE
    v_results_written := private.materialize_quiz_event_results_v2(p_event_id);
  END IF;

  UPDATE private.quiz_edge_scoring_runs
  SET status = 'completed',
      attempts_written = v_attempts_written,
      questions_written = 0,
      answers_written = 0,
      results_written = v_results_written,
      completed_at = pg_catalog.clock_timestamp()
  WHERE id = v_run_id;

  UPDATE public.quiz_events
  SET edge_manifest_checksum_sha256 = v_manifest_checksum,
      edge_completed_scoring_run_id = v_run_id,
      attempts_terminalized_at = COALESCE(
        attempts_terminalized_at,
        v_persisted_close_at
      ),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_event_id;

  RETURN pg_catalog.jsonb_build_object(
    'scoringRunId', v_run_id,
    'eventId', p_event_id,
    'reused', false,
    'manifestChecksumSha256', v_manifest_checksum,
    'persistedCloseAt', v_persisted_close_at,
    'tailBatchesScored', COALESCE((v_tail_res ->> 'batchesScored')::integer, 0),
    'tailAttemptsScored', COALESCE((v_tail_res ->> 'attemptsScored')::integer, 0),
    'attemptsWritten', v_attempts_written,
    'questionsWritten', 0,
    'answersWritten', 0,
    'resultsWritten', v_results_written,
    'canonicalAnswersBackfillDeferred', true
  );
END;
$$;

ALTER FUNCTION private.score_and_materialize_edge_quiz_event_v2(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.score_and_materialize_edge_quiz_event_v2(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.backfill_quiz_edge_canonical_answers_v2(
  p_event_id uuid,
  p_limit_attempts integer DEFAULT 10000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_answers_written integer := 0;
  v_attempts_backfilled integer := 0;
  v_event public.quiz_events%ROWTYPE;
  v_limit integer := COALESCE(p_limit_attempts, 10000);
  v_questions_written integer := 0;
  v_remaining_attempts integer := 0;
BEGIN
  IF p_event_id IS NULL OR v_limit < 1 OR v_limit > 100000 THEN
    RAISE EXCEPTION 'invalid_quiz_edge_backfill_args' USING ERRCODE = '22023';
  END IF;

  SELECT event.*
  INTO v_event
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id
  FOR SHARE;

  IF v_event.id IS NULL OR v_event.contract_version <> 2 THEN
    RAISE EXCEPTION 'quiz_event_not_found' USING ERRCODE = 'QZ003';
  END IF;
  IF v_event.backend_mode <> 'edge_rooms' THEN
    RAISE EXCEPTION 'quiz_backend_mode_mismatch' USING ERRCODE = 'QZ062';
  END IF;
  IF v_event.edge_completed_scoring_run_id IS NULL THEN
    RAISE EXCEPTION 'quiz_edge_manifest_not_reconciled' USING ERRCODE = 'QZ068';
  END IF;

  DROP TABLE IF EXISTS pg_temp._edge_backfill_targets;
  CREATE TEMP TABLE _edge_backfill_targets ON COMMIT DROP AS
  SELECT sa.attempt_id
  FROM private.quiz_edge_scored_attempts AS sa
  WHERE sa.event_id = p_event_id
    AND sa.canonical_answers_backfilled_at IS NULL
  ORDER BY sa.attempt_id
  LIMIT v_limit
  FOR UPDATE OF sa SKIP LOCKED;

  SELECT pg_catalog.count(*)::integer
  INTO v_attempts_backfilled
  FROM _edge_backfill_targets;

  IF v_attempts_backfilled > 0 THEN
    DROP TABLE IF EXISTS pg_temp._edge_scored_answers;
    CREATE TEMP TABLE _edge_scored_answers ON COMMIT DROP AS
    WITH expanded AS (
      SELECT
        s.attempt_id,
        ans.slot_id AS raw_slot_id,
        ans.variant_id,
        ans.position,
        COALESCE(ans.option_order, '[]'::jsonb) AS option_order,
        ans.issued_at,
        ans.received_at,
        ans.raw_answer,
        ans.selected_answer_hash,
        COALESCE(ans.timeout, false) AS is_timeout,
        variant.slot_id AS variant_slot_id,
        variant.answer_key_hash,
        pg_catalog.md5(s.attempt_id::text || ':q:' || ans.position::text) AS q_hash,
        CASE
          WHEN ans.issued_at IS NULL THEN NULL
          ELSE LEAST(
            v_event.ends_at,
            ans.issued_at + pg_catalog.make_interval(
              secs => GREATEST(v_event.time_per_question_seconds, 0)
            )
          )
        END AS question_deadline,
        CASE
          WHEN ans.raw_answer IS NOT NULL THEN
            pg_catalog.encode(
              extensions.digest(
                pg_catalog.lower(pg_catalog.btrim(ans.raw_answer)),
                'sha256'
              ),
              'hex'
            )
          WHEN ans.selected_answer_hash ~ '^[0-9a-fA-F]{64}$' THEN
            pg_catalog.lower(ans.selected_answer_hash)
          ELSE NULL
        END AS computed_answer_hash
      FROM _edge_backfill_targets AS bt
      JOIN private.quiz_edge_attempt_staging AS s
        ON s.event_id = p_event_id
       AND s.attempt_id = bt.attempt_id
      JOIN public.quiz_attempts AS qa
        ON qa.id = bt.attempt_id
       AND qa.event_id = p_event_id
      CROSS JOIN LATERAL pg_catalog.jsonb_to_recordset(s.answers) AS ans(
        slot_id uuid,
        variant_id uuid,
        position integer,
        option_order jsonb,
        issued_at timestamptz,
        received_at timestamptz,
        raw_answer text,
        selected_answer_hash text,
        timeout boolean
      )
      JOIN public.quiz_question_variants AS variant
        ON variant.id = ans.variant_id
    )
    SELECT
      e.attempt_id,
      (
        pg_catalog.substr(e.q_hash, 1, 8) || '-' ||
        pg_catalog.substr(e.q_hash, 9, 4) || '-4' ||
        pg_catalog.substr(e.q_hash, 14, 3) || '-a' ||
        pg_catalog.substr(e.q_hash, 18, 3) || '-' ||
        pg_catalog.substr(e.q_hash, 21, 12)
      )::uuid AS attempt_question_id,
      COALESCE(e.raw_slot_id, e.variant_slot_id) AS slot_id,
      e.variant_id,
      e.position,
      e.option_order,
      e.issued_at,
      v_event.time_per_question_seconds * 1000 AS time_limit_ms,
      e.received_at,
      e.is_timeout,
      e.question_deadline,
      e.computed_answer_hash,
      (
        e.is_timeout
        OR (e.issued_at IS NOT NULL AND e.received_at IS NOT NULL AND e.received_at < v_event.ends_at)
      ) AS emit_answer_row,
      CASE
        WHEN v_event.status = 'cancelled' THEN 0
        WHEN e.is_timeout THEN 0
        WHEN e.issued_at IS NULL OR e.received_at IS NULL THEN 0
        WHEN e.received_at >= e.question_deadline THEN 0
        WHEN e.answer_key_hash ~ '^[0-9a-fA-F]{64}$'
          AND e.computed_answer_hash IS NOT NULL
          AND e.computed_answer_hash = pg_catalog.lower(e.answer_key_hash)
          THEN 1
        ELSE 0
      END AS score_delta
    FROM expanded AS e;

    INSERT INTO public.quiz_attempt_questions (
      id,
      attempt_id,
      slot_id,
      variant_id,
      position,
      option_order,
      issued_at,
      time_limit_ms
    )
    SELECT
      sa.attempt_question_id,
      sa.attempt_id,
      sa.slot_id,
      sa.variant_id,
      sa.position,
      sa.option_order,
      sa.issued_at,
      sa.time_limit_ms
    FROM _edge_scored_answers AS sa
    ORDER BY sa.attempt_id, sa.position
    ON CONFLICT (attempt_id, position) DO NOTHING;

    GET DIAGNOSTICS v_questions_written = ROW_COUNT;

    INSERT INTO public.quiz_attempt_answers (
      attempt_question_id,
      answer_payload,
      answered_at,
      answered_in_ms,
      score_delta
    )
    SELECT
      sa.attempt_question_id,
      pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'selected_answer_hash', sa.computed_answer_hash,
          'late', CASE
            WHEN sa.is_timeout THEN NULL
            ELSE sa.received_at >= sa.question_deadline
          END,
          'timeout', CASE WHEN sa.is_timeout THEN true ELSE NULL END,
          'v2', true,
          'edge_room', true
        )
      ),
      CASE
        WHEN sa.is_timeout THEN sa.question_deadline
        ELSE GREATEST(sa.received_at, sa.issued_at)
      END,
      CASE
        WHEN sa.is_timeout THEN LEAST(v_event.time_per_question_seconds * 1000, 60000)
        ELSE LEAST(
          GREATEST(
            0,
            pg_catalog.floor(
              EXTRACT(epoch FROM (sa.received_at - sa.issued_at)) * 1000
            )::bigint
          ),
          60000
        )::integer
      END,
      sa.score_delta
    FROM _edge_scored_answers AS sa
    WHERE sa.emit_answer_row
    ORDER BY sa.attempt_question_id
    ON CONFLICT (attempt_question_id) DO NOTHING;

    GET DIAGNOSTICS v_answers_written = ROW_COUNT;

    DROP TABLE IF EXISTS pg_temp._edge_scored_answers;

    UPDATE private.quiz_edge_scored_attempts AS sa
    SET canonical_answers_backfilled_at = pg_catalog.clock_timestamp()
    FROM _edge_backfill_targets AS bt
    WHERE sa.event_id = p_event_id
      AND sa.attempt_id = bt.attempt_id
      AND sa.canonical_answers_backfilled_at IS NULL;
  END IF;

  DROP TABLE IF EXISTS pg_temp._edge_backfill_targets;

  SELECT pg_catalog.count(*)::integer
  INTO v_remaining_attempts
  FROM private.quiz_edge_scored_attempts AS sa
  WHERE sa.event_id = p_event_id
    AND sa.canonical_answers_backfilled_at IS NULL;

  RETURN pg_catalog.jsonb_build_object(
    'eventId', p_event_id,
    'attemptsBackfilled', v_attempts_backfilled,
    'questionsWritten', v_questions_written,
    'answersWritten', v_answers_written,
    'remainingAttempts', v_remaining_attempts
  );
END;
$$;

ALTER FUNCTION private.backfill_quiz_edge_canonical_answers_v2(uuid, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.backfill_quiz_edge_canonical_answers_v2(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Two-fact publication gate across deadline jobs & publication triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.terminalize_quiz_event_attempts_v2(
  p_event_id uuid,
  p_now timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_backend_mode text;
  v_count integer;
BEGIN
  SELECT event.backend_mode
  INTO v_backend_mode
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id;

  IF v_backend_mode = 'edge_rooms' THEN
    RAISE EXCEPTION 'quiz_edge_event_cannot_sql_terminalize'
      USING ERRCODE = 'QZ065';
  END IF;

  UPDATE public.quiz_attempts AS a
  SET status = 'submitted',
      submitted_at = COALESCE(a.submitted_at, p_now),
      score = COALESCE(
        (
          SELECT pg_catalog.sum(ans.score_delta)::integer
          FROM public.quiz_attempt_questions AS q
          LEFT JOIN public.quiz_attempt_answers AS ans
            ON ans.attempt_question_id = q.id
          WHERE q.attempt_id = a.id
        ),
        0
      )
  WHERE a.event_id = p_event_id
    AND a.status = 'started';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER FUNCTION private.terminalize_quiz_event_attempts_v2(uuid, timestamptz)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.terminalize_quiz_event_attempts_v2(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.finalize_due_test_quiz_events_clock_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event record;
  v_attempts integer := 0;
  v_closed integer := 0;
  v_failed integer := 0;
  v_ranked integer;
  v_retry_waiting integer := 0;
  v_should_log_failure boolean;
  v_zero integer := 0;
BEGIN
  SELECT pg_catalog.count(*)::integer
  INTO v_retry_waiting
  FROM public.quiz_events AS event
  WHERE event.contract_version = 2
    AND event.mode = 'test'
    AND event.status IN ('active', 'scheduled')
    AND event.ends_at <= pg_catalog.clock_timestamp()
    AND (
      event.backend_mode = 'postgres'
      OR private.quiz_edge_event_ready_for_publication_v2(event.id)
    )
    AND event.finalization_error_code = 'test_result_publication_failed'
    AND event.updated_at >
      pg_catalog.clock_timestamp() - interval '30 seconds';

  FOR v_event IN
    SELECT
      event.id,
      event.backend_mode,
      event.finalization_state,
      event.finalization_error_code
    FROM public.quiz_events AS event
    WHERE event.contract_version = 2
      AND event.mode = 'test'
      AND event.status IN ('active', 'scheduled')
      AND event.ends_at <= pg_catalog.clock_timestamp()
      AND (
        event.backend_mode = 'postgres'
        OR private.quiz_edge_event_ready_for_publication_v2(event.id)
      )
      AND (
        event.finalization_error_code IS DISTINCT FROM
          'test_result_publication_failed'
        OR event.updated_at <=
          pg_catalog.clock_timestamp() - interval '30 seconds'
      )
    ORDER BY
      (event.finalization_error_code =
        'test_result_publication_failed') NULLS FIRST,
      event.ends_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      IF v_event.backend_mode = 'postgres' THEN
        v_attempts := private.terminalize_quiz_event_attempts_v2(
          v_event.id, pg_catalog.clock_timestamp()
        );
      ELSE
        SELECT pg_catalog.count(*)::integer
        INTO v_attempts
        FROM public.quiz_attempts AS a
        WHERE a.event_id = v_event.id;
      END IF;
      v_ranked := private.materialize_quiz_event_results_v2(v_event.id);
      UPDATE public.quiz_events
      SET status = 'completed',
          attempts_terminalized_at = COALESCE(
            attempts_terminalized_at,
            CASE
              WHEN v_event.backend_mode = 'edge_rooms' THEN edge_persisted_close_at
              ELSE pg_catalog.clock_timestamp()
            END
          ),
          finalization_state = 'test_published',
          finalization_error_code = NULL,
          award_finalized_at = COALESCE(
            award_finalized_at, pg_catalog.clock_timestamp()
          ),
          results_published_at = COALESCE(
            results_published_at, pg_catalog.clock_timestamp()
          ),
          updated_at = pg_catalog.clock_timestamp()
      WHERE id = v_event.id;
      INSERT INTO public.leaderboard_refresh_log(
        event_id, refresh_reason, status, details
      ) VALUES (
        v_event.id, 'quiz_v2_test_finalized', 'succeeded',
        pg_catalog.jsonb_build_object(
          'rankedParticipants', v_ranked,
          'terminalizedAttempts', v_attempts
        )
      );
      IF v_ranked = 0 THEN v_zero := v_zero + 1; END IF;
      v_closed := v_closed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_should_log_failure :=
        v_event.finalization_state IS DISTINCT FROM 'blocked'
        OR v_event.finalization_error_code IS DISTINCT FROM
          'test_result_publication_failed';
      BEGIN
        UPDATE public.quiz_events
        SET finalization_state = 'blocked',
            finalization_error_code = 'test_result_publication_failed',
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_event.id;
      EXCEPTION WHEN OTHERS THEN
        v_should_log_failure := false;
      END;
      IF v_should_log_failure THEN
        BEGIN
          INSERT INTO public.leaderboard_refresh_log(
            event_id, refresh_reason, status, details
          ) VALUES (
            v_event.id, 'quiz_v2_test_finalized', 'failed',
            pg_catalog.jsonb_build_object(
              'code', 'test_result_publication_failed'
            )
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
    END;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object(
    'testClosed', v_closed,
    'testPublicationFailed', v_failed,
    'testPublicationRetryPending', v_retry_waiting,
    'testZeroPlayerClosed', v_zero
  );
END;
$$;

ALTER FUNCTION private.finalize_due_test_quiz_events_clock_v2()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.finalize_due_test_quiz_events_clock_v2()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.terminalize_due_live_quiz_events_clock_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event record;
  v_closed integer := 0;
  v_failed integer := 0;
  v_retry_waiting integer := 0;
  v_should_log_failure boolean;
  v_zero integer := 0;
BEGIN
  SELECT pg_catalog.count(*)::integer
  INTO v_retry_waiting
  FROM public.quiz_events AS event
  WHERE event.contract_version = 2
    AND event.mode = 'live'
    AND event.backend_mode = 'postgres'
    AND event.status IN ('active', 'scheduled')
    AND event.ends_at <= pg_catalog.clock_timestamp()
    AND event.attempts_terminalized_at IS NULL
    AND event.finalization_error_code =
      'live_attempt_terminalization_failed'
    AND event.updated_at >
      pg_catalog.clock_timestamp() - interval '30 seconds';

  -- Edge-backed events are terminalized by score_and_materialize_edge_quiz_event_v2
  -- after room sealing and reconciliation, never by the SQL deadline clock.
  FOR v_event IN
    SELECT event.id, event.finalization_error_code
    FROM public.quiz_events AS event
    WHERE event.contract_version = 2
      AND event.mode = 'live'
      AND event.backend_mode = 'postgres'
      AND event.status IN ('active', 'scheduled')
      AND event.ends_at <= pg_catalog.clock_timestamp()
      AND event.attempts_terminalized_at IS NULL
      AND (
        event.finalization_error_code IS DISTINCT FROM
          'live_attempt_terminalization_failed'
        OR event.updated_at <=
          pg_catalog.clock_timestamp() - interval '30 seconds'
      )
    ORDER BY
      (event.finalization_error_code =
        'live_attempt_terminalization_failed') NULLS FIRST,
      event.ends_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM private.terminalize_quiz_event_attempts_v2(
        v_event.id, pg_catalog.clock_timestamp()
      );
      UPDATE public.quiz_events
      SET attempts_terminalized_at = pg_catalog.clock_timestamp(),
          finalization_state = CASE
            WHEN finalization_state IN ('awarded', 'no_winner')
              THEN finalization_state
            ELSE 'pending'
          END,
          finalization_error_code = CASE
            WHEN finalization_state IN ('awarded', 'no_winner')
              THEN finalization_error_code
            ELSE NULL
          END,
          updated_at = pg_catalog.clock_timestamp()
      WHERE id = v_event.id;
      IF NOT EXISTS (
        SELECT 1 FROM public.quiz_attempts WHERE event_id = v_event.id
      ) THEN v_zero := v_zero + 1; END IF;
      v_closed := v_closed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_should_log_failure :=
        v_event.finalization_error_code IS DISTINCT FROM
          'live_attempt_terminalization_failed';
      BEGIN
        UPDATE public.quiz_events
        SET finalization_state = 'blocked',
            finalization_error_code =
              'live_attempt_terminalization_failed',
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_event.id;
      EXCEPTION WHEN OTHERS THEN
        v_should_log_failure := false;
      END;
      IF v_should_log_failure THEN
        BEGIN
          INSERT INTO public.leaderboard_refresh_log(
            event_id, refresh_reason, status, details
          ) VALUES (
            v_event.id, 'quiz_v2_live_terminalized', 'failed',
            pg_catalog.jsonb_build_object(
              'code', 'live_attempt_terminalization_failed'
            )
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
    END;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object(
    'liveTerminalizationFailed', v_failed,
    'liveTerminalizationRetryPending', v_retry_waiting,
    'liveTerminalized', v_closed,
    'liveZeroPlayerClosed', v_zero
  );
END;
$$;

ALTER FUNCTION private.terminalize_due_live_quiz_events_clock_v2()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.terminalize_due_live_quiz_events_clock_v2()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_due_live_quiz_events_v2(
  p_production_phase boolean,
  p_production_approved boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.quiz_events%ROWTYPE;
  v_winner public.quiz_event_results_v2%ROWTYPE;
  v_awarded integer := 0;
  v_none integer := 0;
  v_blocked integer := 0;
  v_failed integer := 0;
  v_outcome text;
  v_retry_waiting integer := 0;
  v_should_log_failure boolean;
BEGIN
  WITH blocked_event AS (
    SELECT event.id
    FROM public.quiz_events AS event
    WHERE event.contract_version = 2
      AND event.mode = 'live'
      AND event.status <> 'cancelled'
      AND event.ends_at <= pg_catalog.clock_timestamp()
      AND (
        event.attempts_terminalized_at IS NOT NULL
        OR event.backend_mode = 'edge_rooms'
      )
      AND event.finalization_state IN ('pending', 'blocked')
      AND event.results_published_at IS NULL
      AND NOT (
        p_production_phase IS TRUE
        AND p_production_approved IS TRUE
        AND private.quiz_live_prize_regulatory_ready_v2(event.id)
        AND event.claim_window_seconds IS NOT NULL
        AND event.attempts_terminalized_at IS NOT NULL
        AND (
          event.backend_mode = 'postgres'
          OR private.quiz_edge_event_ready_for_publication_v2(event.id)
        )
        AND EXISTS (
          SELECT 1
          FROM public.quiz_prize_reservations AS reservation
          WHERE reservation.event_id = event.id
            AND reservation.state = 'reserved'
        )
      )
      AND (
        event.finalization_state IS DISTINCT FROM 'blocked'
        OR event.finalization_error_code IS DISTINCT FROM
          'live_award_gate_unavailable'
      )
    ORDER BY event.ends_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.quiz_events AS event
  SET finalization_state = 'blocked',
      finalization_error_code = 'live_award_gate_unavailable',
      updated_at = pg_catalog.clock_timestamp()
  FROM blocked_event
  WHERE event.id = blocked_event.id;

  SELECT pg_catalog.count(*)::integer
  INTO v_blocked
  FROM public.quiz_events AS event
  WHERE event.contract_version = 2
    AND event.mode = 'live'
    AND event.status <> 'cancelled'
    AND event.ends_at <= pg_catalog.clock_timestamp()
    AND (
      event.attempts_terminalized_at IS NOT NULL
      OR event.backend_mode = 'edge_rooms'
    )
    AND event.finalization_state IN ('pending', 'blocked')
    AND event.results_published_at IS NULL
    AND NOT (
      p_production_phase IS TRUE
      AND p_production_approved IS TRUE
      AND private.quiz_live_prize_regulatory_ready_v2(event.id)
      AND event.claim_window_seconds IS NOT NULL
      AND event.attempts_terminalized_at IS NOT NULL
      AND (
        event.backend_mode = 'postgres'
        OR private.quiz_edge_event_ready_for_publication_v2(event.id)
      )
      AND EXISTS (
        SELECT 1
        FROM public.quiz_prize_reservations AS reservation
        WHERE reservation.event_id = event.id
          AND reservation.state = 'reserved'
      )
    );

  IF p_production_phase IS TRUE
    AND p_production_approved IS TRUE THEN
    SELECT pg_catalog.count(*)::integer
    INTO v_retry_waiting
    FROM public.quiz_events AS event
    WHERE event.contract_version = 2
      AND event.mode = 'live'
      AND event.status <> 'cancelled'
      AND event.ends_at <= pg_catalog.clock_timestamp()
      AND event.attempts_terminalized_at IS NOT NULL
      AND event.finalization_state = 'blocked'
      AND event.results_published_at IS NULL
      AND event.finalization_error_code = 'live_award_transfer_failed'
      AND event.updated_at >
        pg_catalog.clock_timestamp() - interval '30 seconds'
      AND (
        event.backend_mode = 'postgres'
        OR private.quiz_edge_event_ready_for_publication_v2(event.id)
      )
      AND private.quiz_live_prize_regulatory_ready_v2(event.id)
      AND event.claim_window_seconds IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.quiz_prize_reservations AS reservation
        WHERE reservation.event_id = event.id
          AND reservation.state = 'reserved'
      );
  END IF;

  IF p_production_phase IS NOT TRUE
    OR p_production_approved IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object(
      'awarded', v_awarded,
      'failed', v_failed,
      'liveAwardRetryPending', v_retry_waiting,
      'liveAwaitingGate', v_blocked,
      'noWinner', v_none
    );
  END IF;

  FOR v_event IN
    SELECT event.*
    FROM public.quiz_events AS event
    WHERE event.contract_version = 2
      AND event.mode = 'live'
      AND event.status <> 'cancelled'
      AND event.ends_at <= pg_catalog.clock_timestamp()
      AND event.attempts_terminalized_at IS NOT NULL
      AND event.finalization_state IN ('pending', 'blocked')
      AND event.results_published_at IS NULL
      AND (
        event.backend_mode = 'postgres'
        OR private.quiz_edge_event_ready_for_publication_v2(event.id)
      )
      AND private.quiz_live_prize_regulatory_ready_v2(event.id)
      AND event.claim_window_seconds IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.quiz_prize_reservations AS reservation
        WHERE reservation.event_id = event.id
          AND reservation.state = 'reserved'
      )
      AND (
        event.finalization_error_code IS DISTINCT FROM
          'live_award_transfer_failed'
        OR event.updated_at <=
          pg_catalog.clock_timestamp() - interval '30 seconds'
      )
    ORDER BY (event.finalization_state = 'blocked'), event.ends_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM private.materialize_quiz_event_results_v2(v_event.id);
      SELECT result.*
      INTO v_winner
      FROM public.quiz_event_results_v2 AS result
      WHERE result.event_id = v_event.id
        AND result.rank = 1;

      IF v_winner.attempt_id IS NULL THEN
        PERFORM private.release_quiz_prize_reservation_v2(
          v_event.id, 'no_eligible_winner'
        );
        UPDATE public.quiz_events
        SET status = 'completed',
            finalization_state = 'no_winner',
            finalization_error_code = NULL,
            award_finalized_at = pg_catalog.clock_timestamp(),
            results_published_at = pg_catalog.clock_timestamp(),
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_event.id;
        v_none := v_none + 1;
        v_outcome := 'no_winner';
      ELSE
        PERFORM private.transfer_quiz_prize_to_winner_v2(
          v_event.id, v_winner.attempt_id, v_winner.customer_id
        );
        UPDATE public.quiz_events
        SET status = 'completed',
            finalization_state = 'awarded',
            finalization_error_code = NULL,
            award_finalized_at = pg_catalog.clock_timestamp(),
            results_published_at = pg_catalog.clock_timestamp(),
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_event.id;
        v_awarded := v_awarded + 1;
        v_outcome := 'awarded';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_should_log_failure := v_event.finalization_error_code IS DISTINCT FROM
        'live_award_transfer_failed';
      BEGIN
        UPDATE public.quiz_events
        SET finalization_state = 'blocked',
            finalization_error_code = 'live_award_transfer_failed',
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_event.id;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
      IF v_should_log_failure THEN
        BEGIN
          INSERT INTO public.leaderboard_refresh_log(
            event_id, refresh_reason, status, details
          ) VALUES (
            v_event.id, 'quiz_v2_live_finalized', 'failed',
            pg_catalog.jsonb_build_object(
              'code', 'live_award_transfer_failed'
            )
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
      CONTINUE;
    END;

    BEGIN
      INSERT INTO public.leaderboard_refresh_log(
        event_id, refresh_reason, status, details
      ) VALUES (
        v_event.id, 'quiz_v2_live_finalized', 'succeeded',
        pg_catalog.jsonb_build_object('outcome', v_outcome)
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'awarded', v_awarded,
    'failed', v_failed,
    'liveAwardRetryPending', v_retry_waiting,
    'liveAwaitingGate', v_blocked + v_retry_waiting + v_failed,
    'noWinner', v_none
  );
END;
$$;

ALTER FUNCTION public.finalize_due_live_quiz_events_v2(boolean, boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_due_live_quiz_events_v2(
  boolean, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_due_live_quiz_events_v2(
  boolean, boolean
) TO service_role;

-- Enforce the two-fact gate inside all three publication guard triggers.
CREATE OR REPLACE FUNCTION private.guard_live_quiz_score_publication_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ready boolean := false;
BEGIN
  IF NEW.contract_version <> 2
    OR NEW.mode <> 'live'
    OR OLD.results_published_at IS NOT NULL
    OR NEW.results_published_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT control.score_repair_ready
  INTO v_ready
  FROM private.quiz_test_publication_control_v2 AS control
  WHERE control.singleton;

  IF COALESCE(v_ready, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'quiz_live_score_publication_not_ready';
  END IF;

  IF NEW.backend_mode = 'edge_rooms'
    AND NOT private.quiz_edge_event_ready_for_publication_v2(NEW.id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'quiz_edge_reconciliation_not_ready';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_test_quiz_result_publication_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ready boolean := false;
BEGIN
  IF NEW.contract_version <> 2
    OR NEW.mode <> 'test'
    OR OLD.results_published_at IS NOT NULL
    OR NEW.results_published_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT control.score_repair_ready
  INTO v_ready
  FROM private.quiz_test_publication_control_v2 AS control
  WHERE control.singleton;

  IF COALESCE(v_ready, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'quiz_test_score_publication_not_ready';
  END IF;

  IF NEW.backend_mode = 'edge_rooms'
    AND NOT private.quiz_edge_event_ready_for_publication_v2(NEW.id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'quiz_edge_reconciliation_not_ready';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_live_quiz_result_publication_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gate_open boolean := false;
BEGIN
  IF NEW.contract_version <> 2
    OR NEW.mode <> 'live'
    OR OLD.results_published_at IS NOT NULL
    OR NEW.results_published_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    control.production_phase IS TRUE
      AND control.production_approved IS TRUE
      AND control.updated_at >=
        pg_catalog.transaction_timestamp() - interval '30 seconds'
  INTO v_gate_open
  FROM public.quiz_runtime_control_v2 AS control
  WHERE control.singleton;

  IF COALESCE(v_gate_open, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'quiz_live_publication_runtime_gate_closed';
  END IF;

  IF NEW.backend_mode = 'edge_rooms'
    AND NOT private.quiz_edge_event_ready_for_publication_v2(NEW.id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'quiz_edge_reconciliation_not_ready';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION private.guard_live_quiz_score_publication_v2() OWNER TO postgres;
ALTER FUNCTION private.guard_test_quiz_result_publication_v2() OWNER TO postgres;
ALTER FUNCTION private.guard_live_quiz_result_publication_v2() OWNER TO postgres;
REVOKE ALL ON FUNCTION
  private.guard_live_quiz_score_publication_v2(),
  private.guard_test_quiz_result_publication_v2(),
  private.guard_live_quiz_result_publication_v2()
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

-- Merchant-authorized RPC to configure `backend_mode = 'edge_rooms'` on a
-- draft v2 quiz event and return the authoritative `QuizEventConfig` payload
-- (including private `answer_key_hash` values, which are column-revoked from
-- `authenticated`) so `apps/web` can provision Cloudflare Edge Quiz Rooms via
-- `POST /api/quiz/admin/init-rooms` BEFORE flipping launch status.

BEGIN;

CREATE OR REPLACE FUNCTION public.prepare_quiz_edge_rooms_v2(
  p_event_id uuid,
  p_merchant_id uuid,
  p_expected_room_count integer DEFAULT 4,
  p_starts_at timestamptz DEFAULT NULL,
  p_ends_at timestamptz DEFAULT NULL,
  p_target_status text DEFAULT NULL,
  p_rules_version text DEFAULT NULL,
  p_question_count integer DEFAULT NULL,
  p_time_per_question_seconds integer DEFAULT NULL,
  p_max_attempts integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_event public.quiz_events%ROWTYPE;
  v_room_count integer;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_target_status text;
  v_rules_version text;
  v_question_count integer;
  v_time_per_question integer;
  v_max_attempts integer;
  v_room_ids jsonb;
  v_slots jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_event_id IS NULL OR p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'quiz_event_not_found' USING ERRCODE = 'QZ003';
  END IF;

  IF NOT public.check_staff_permission(
    v_actor_id, p_merchant_id, 'marketing', 'edit'
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF p_expected_room_count IS NULL OR p_expected_room_count < 1 OR p_expected_room_count > 256 THEN
    RAISE EXCEPTION 'quiz_edge_room_count_invalid' USING ERRCODE = '22023';
  END IF;
  v_room_count := p_expected_room_count;

  SELECT event.*
  INTO v_event
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id
    AND event.merchant_id = p_merchant_id
  FOR UPDATE;

  IF v_event.id IS NULL OR v_event.contract_version <> 2 THEN
    RAISE EXCEPTION 'quiz_event_not_found' USING ERRCODE = 'QZ003';
  END IF;

  -- Only drafts may be prepared so retries against already-launched events
  -- cannot mutate backend_mode/expected_room_count or re-initialize live rooms.
  IF v_event.status <> 'draft' THEN
    RAISE EXCEPTION 'quiz_event_not_provisionable' USING ERRCODE = 'QZ061';
  END IF;

  v_target_status := COALESCE(NULLIF(pg_catalog.btrim(p_target_status), ''), v_event.status);
  IF v_target_status NOT IN ('draft', 'scheduled', 'active') THEN
    RAISE EXCEPTION 'quiz_event_not_provisionable' USING ERRCODE = 'QZ061';
  END IF;

  v_starts_at := COALESCE(p_starts_at, v_event.starts_at);
  v_ends_at := COALESCE(p_ends_at, v_event.ends_at);
  IF v_starts_at IS NULL OR v_ends_at IS NULL OR v_ends_at <= v_starts_at THEN
    RAISE EXCEPTION 'quiz_event_timing_missing' USING ERRCODE = 'QZ061';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', slot.id,
        'slotIndex', slot.slot_index,
        'active', slot.active,
        'variants', COALESCE(
          (
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'id', variant.id,
                'slotId', variant.slot_id,
                'prompt', variant.prompt,
                'options', variant.options,
                'answerKeyHash', variant.answer_key_hash,
                'active', variant.active
              )
              ORDER BY variant.id ASC
            )
            FROM public.quiz_question_variants AS variant
            WHERE variant.slot_id = slot.id
              AND variant.active IS TRUE
              AND variant.answer_key_hash IS NOT NULL
          ),
          '[]'::jsonb
        )
      )
      ORDER BY slot.slot_index ASC, slot.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_slots
  FROM public.quiz_question_slots AS slot
  WHERE slot.event_id = v_event.id
    AND slot.active IS TRUE;

  -- Validate the question pool BEFORE mutating backend_mode so an incomplete
  -- pool (zero slots or any active slot with zero qualifying variants) fails
  -- cleanly without flipping backend_mode.
  IF pg_catalog.jsonb_array_length(v_slots) = 0
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(v_slots) AS elem
      WHERE pg_catalog.jsonb_array_length(elem->'variants') = 0
    )
  THEN
    RAISE EXCEPTION 'quiz_question_pool_incomplete' USING ERRCODE = 'QZ003';
  END IF;

  v_question_count := COALESCE(
    p_question_count,
    v_event.question_count,
    pg_catalog.jsonb_array_length(v_slots)
  );
  v_time_per_question := COALESCE(
    p_time_per_question_seconds,
    v_event.time_per_question_seconds,
    15
  );
  v_max_attempts := COALESCE(p_max_attempts, v_event.max_attempts, 1);
  v_rules_version := COALESCE(
    NULLIF(pg_catalog.btrim(p_rules_version), ''),
    v_event.rules_version,
    'v2'
  );

  IF v_question_count < 1 OR v_time_per_question < 1 OR v_max_attempts < 1 THEN
    RAISE EXCEPTION 'quiz_edge_config_invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE public.quiz_events
  SET backend_mode = 'edge_rooms',
      expected_room_count = v_room_count,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_event.id
  RETURNING * INTO v_event;

  SELECT pg_catalog.jsonb_agg(
    v_event.id::text || ':room-' || pg_catalog.lpad(idx::text, 4, '0')
    ORDER BY idx ASC
  )
  INTO v_room_ids
  FROM pg_catalog.generate_series(0, v_room_count - 1) AS idx;

  RETURN pg_catalog.jsonb_build_object(
    'roomIds', v_room_ids,
    'config', pg_catalog.jsonb_build_object(
      'eventId', v_event.id,
      'merchantId', v_event.merchant_id,
      'mode', v_event.mode,
      'contractVersion', 2,
      'rulesVersion', v_rules_version,
      'questionCount', v_question_count,
      'timePerQuestionSeconds', v_time_per_question,
      'maxAttempts', v_max_attempts,
      'startsAtMs', (EXTRACT(EPOCH FROM v_starts_at) * 1000)::bigint,
      'endsAtMs', (EXTRACT(EPOCH FROM v_ends_at) * 1000)::bigint,
      'status', v_target_status,
      'slots', v_slots
    )
  );
END;
$$;

ALTER FUNCTION public.prepare_quiz_edge_rooms_v2(
  uuid, uuid, integer, timestamptz, timestamptz, text, text, integer, integer, integer
)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prepare_quiz_edge_rooms_v2(
  uuid, uuid, integer, timestamptz, timestamptz, text, text, integer, integer, integer
)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_quiz_edge_rooms_v2(
  uuid, uuid, integer, timestamptz, timestamptz, text, text, integer, integer, integer
)
  TO authenticated, service_role;

COMMIT;

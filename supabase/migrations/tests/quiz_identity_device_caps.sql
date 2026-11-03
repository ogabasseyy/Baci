-- Regression coverage for 20260714102200_quiz_identity_and_device_caps.sql.
-- Usage: psql $DATABASE_URL -f supabase/migrations/tests/quiz_identity_device_caps.sql

BEGIN;

SELECT pg_catalog.set_config(
  'app.quiz_rpc_server_secret_current',
  'quiz-device-cap-test-secret',
  true
);

\ir quiz_identity_device_caps.helpers.inc.sql

INSERT INTO public.merchants (id, name, slug)
VALUES (
  '00000000-0000-4000-8000-00000000d001',
  'Quiz Device Cap Test',
  'quiz-device-cap-test'
);

INSERT INTO public.customers (id, merchant_id, user_id, full_name, email)
VALUES
  (
    '00000000-0000-4000-8000-00000000d101',
    '00000000-0000-4000-8000-00000000d001',
    '00000000-0000-4000-8000-00000000d201',
    'Device Player One',
    'player.one@gmail.com'
  ),
  (
    '00000000-0000-4000-8000-00000000d102',
    '00000000-0000-4000-8000-00000000d001',
    '00000000-0000-4000-8000-00000000d202',
    'Device Player Two',
    'player.two@example.com'
  ),
  (
    '00000000-0000-4000-8000-00000000d103',
    '00000000-0000-4000-8000-00000000d001',
    '00000000-0000-4000-8000-00000000d203',
    'Identity Player One',
    'identity.player+one@gmail.com'
  ),
  (
    '00000000-0000-4000-8000-00000000d104',
    '00000000-0000-4000-8000-00000000d001',
    '00000000-0000-4000-8000-00000000d204',
    'Identity Player Two',
    'identityplayer@gmail.com'
  );

INSERT INTO public.quiz_events (id, merchant_id, slug, title, status, settings)
VALUES (
  '00000000-0000-4000-8000-00000000d301',
  '00000000-0000-4000-8000-00000000d001',
  'device-cap-event',
  'Device Cap Event',
  'active',
  '{"max_attempts":1}'::jsonb
);

INSERT INTO public.quiz_question_slots (id, event_id, slot_index)
VALUES (
  '00000000-0000-4000-8000-00000000d501',
  '00000000-0000-4000-8000-00000000d301',
  1
);

INSERT INTO public.quiz_question_variants (
  id,
  slot_id,
  variant_key,
  prompt,
  options,
  answer_key_hash
)
VALUES (
  '00000000-0000-4000-8000-00000000d601',
  '00000000-0000-4000-8000-00000000d501',
  'device-cap-fixture',
  'Fixture question?',
  '[{"id":"A","label":"A"}]'::jsonb,
  pg_catalog.repeat('f', 64)
);

INSERT INTO public.quiz_attempts (
  id,
  event_id,
  customer_id,
  status,
  attempt_number,
  integrity_tier
)
VALUES
  (
    '00000000-0000-4000-8000-00000000d401',
    '00000000-0000-4000-8000-00000000d301',
    '00000000-0000-4000-8000-00000000d101',
    'started',
    1,
    'device'
  ),
  (
    '00000000-0000-4000-8000-00000000d402',
    '00000000-0000-4000-8000-00000000d301',
    '00000000-0000-4000-8000-00000000d102',
    'started',
    1,
    'device'
  );

INSERT INTO public.quiz_attempts (
  id,
  event_id,
  customer_id,
  status,
  attempt_number,
  integrity_tier
)
VALUES (
  '00000000-0000-4000-8000-00000000d403',
  '00000000-0000-4000-8000-00000000d301',
  '00000000-0000-4000-8000-00000000d103',
  'started',
  1,
  'device'
);

INSERT INTO public.quiz_attempt_questions (
  id,
  attempt_id,
  slot_id,
  variant_id,
  position
)
VALUES (
  '00000000-0000-4000-8000-00000000d701',
  '00000000-0000-4000-8000-00000000d402',
  '00000000-0000-4000-8000-00000000d501',
  '00000000-0000-4000-8000-00000000d601',
  1
);

DO $$
BEGIN
  IF public.quiz_normalize_email('victim@gmail.com@invalid') IS NOT NULL THEN
    RAISE EXCEPTION 'multi-separator email unexpectedly normalized';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.quiz_attempts (
      id,
      event_id,
      customer_id,
      status,
      attempt_number,
      integrity_tier
    )
    VALUES (
      '00000000-0000-4000-8000-00000000d404',
      '00000000-0000-4000-8000-00000000d301',
      '00000000-0000-4000-8000-00000000d104',
      'started',
      1,
      'device'
    );
    RAISE EXCEPTION 'normalized email identity cap unexpectedly allowed a second attempt';
  EXCEPTION WHEN SQLSTATE 'QZ040' THEN
    NULL;
  END;
END;
$$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_device_hash constant text := pg_catalog.repeat('a', 64);
  v_user_one constant uuid := '00000000-0000-4000-8000-00000000d201';
  v_user_two constant uuid := '00000000-0000-4000-8000-00000000d202';
  v_accepted boolean;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_user_one::text, true);

  v_accepted := public.bind_quiz_attempt_device(
    '00000000-0000-4000-8000-00000000d401',
    v_device_hash,
    pg_temp.quiz_device_proof(
      '00000000-0000-4000-8000-00000000d401',
      v_device_hash,
      v_user_one
    )
  );
  IF v_accepted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'first device attempt must be accepted';
  END IF;

  BEGIN
    PERFORM public.bind_quiz_attempt_device(
      '00000000-0000-4000-8000-00000000d401',
      pg_catalog.repeat('b', 64),
      '{}'::jsonb
    );
    RAISE EXCEPTION 'unsigned device rebinding unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'QZ010' THEN
    NULL;
  END;

  BEGIN
    PERFORM public.bind_quiz_attempt_device(
      '00000000-0000-4000-8000-00000000d401',
      pg_catalog.repeat('b', 64),
      pg_temp.quiz_device_proof(
        '00000000-0000-4000-8000-00000000d401',
        pg_catalog.repeat('b', 64),
        v_user_one
      )
    );
    RAISE EXCEPTION 'conflicting device rebinding unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'QZ043' THEN
    NULL;
  END;

  BEGIN
    PERFORM public.bind_quiz_attempt_device(
      '00000000-0000-4000-8000-00000000d401',
      'invalid-hash',
      pg_temp.quiz_device_proof(
        '00000000-0000-4000-8000-00000000d401',
        'invalid-hash',
        v_user_one
      )
    );
    RAISE EXCEPTION 'invalid device hash unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'QZ042' THEN
    NULL;
  END;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_user_two::text, true);
  v_accepted := public.bind_quiz_attempt_device(
    '00000000-0000-4000-8000-00000000d402',
    v_device_hash,
    pg_temp.quiz_device_proof(
      '00000000-0000-4000-8000-00000000d402',
      v_device_hash,
      v_user_two
    )
  );
  IF v_accepted IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'over-cap device attempt must be rejected';
  END IF;

  v_accepted := public.bind_quiz_attempt_device(
    '00000000-0000-4000-8000-00000000d402',
    v_device_hash,
    pg_temp.quiz_device_proof(
      '00000000-0000-4000-8000-00000000d402',
      v_device_hash,
      v_user_two
    )
  );
  IF v_accepted IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'replayed rejected binding must remain rejected';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_user_one::text, true);
  v_accepted := public.bind_quiz_attempt_device(
    '00000000-0000-4000-8000-00000000d401',
    v_device_hash,
    pg_temp.quiz_device_proof(
      '00000000-0000-4000-8000-00000000d401',
      v_device_hash,
      v_user_one
    )
  );
  IF v_accepted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'replayed accepted binding must remain accepted';
  END IF;

  BEGIN
    PERFORM public.bind_quiz_attempt_device(
      '00000000-0000-4000-8000-00000000d402',
      v_device_hash,
      pg_temp.quiz_device_proof(
        '00000000-0000-4000-8000-00000000d402',
        v_device_hash,
        v_user_one
      )
    );
    RAISE EXCEPTION 'spoofed attempt owner unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'QZ004' THEN
    NULL;
  END;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.quiz_attempts
    WHERE id = '00000000-0000-4000-8000-00000000d402'
      AND status = 'disqualified'
  ) THEN
    RAISE EXCEPTION 'over-cap attempt disqualification did not persist';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM public.quiz_attempt_devices
    WHERE event_id = '00000000-0000-4000-8000-00000000d301'
      AND device_hash = pg_catalog.repeat('a', 64)
  ) <> 2 THEN
    RAISE EXCEPTION 'accepted and rejected attempts must both retain bindings';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.quiz_attempt_questions
    WHERE attempt_id = '00000000-0000-4000-8000-00000000d402'
  ) THEN
    RAISE EXCEPTION 'rejected attempt retained readable question assignments';
  END IF;
END;
$$;

ROLLBACK;

-- Regression proof for audit finding R1 retention: the cleanup RPC removes the
-- shopper block (data.delivery_user_data) from finished, old rows and leaves
-- recent or unfinished ones untouched.

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_pii jsonb := jsonb_build_object(
    'data', jsonb_build_object(
      'event_type', 'add_to_cart',
      'event_data', jsonb_build_object('user_agent', 'Agent/1.0', 'session_id', 's1'),
      'delivery_user_data', jsonb_build_object('analytics_consent', true, 'marketing_consent', false, 'ip', '203.0.113.1', 'email', 'a@example.com')
    )
  );
  v_old_done uuid := '00000000-0000-4000-8000-00000000e101';
  v_old_open uuid := '00000000-0000-4000-8000-00000000e102';
  v_recent uuid := '00000000-0000-4000-8000-00000000e103';
  v_old_queued uuid := '00000000-0000-4000-8000-00000000e104';
  v_id uuid;
  v_status text;
  v_age interval;
BEGIN
  FOR v_id, v_status, v_age IN
    VALUES (v_old_done, 'delivered', interval '100 days'),
           (v_old_open, 'retry', interval '100 days'),
           (v_recent, 'delivered', interval '10 days')
  LOOP
    INSERT INTO public.domain_event_ledger (
      domain_event_id, producer, trust_level, idempotency_key, event_name,
      subject_type, subject_id, envelope, status, created_at
    ) VALUES (
      v_id, 'sql-retention', 'server', 'retention-' || v_id::text,
      'analytics.add_to_cart.v1', 'event', v_id::text, v_pii, 'routed',
      now() - v_age
    );
    INSERT INTO public.event_deliveries (
      domain_event_id, destination, status, payload, created_at
    ) VALUES (v_id, 'facebook', v_status, v_pii, now() - v_age);
  END LOOP;

  INSERT INTO public.domain_event_failures (
    queue_message_id, original_envelope, failure_code, failure_message,
    first_failed_at, last_failed_at
  ) VALUES
    (9301001, v_pii, 'bad', 'old failure', now() - interval '100 days', now() - interval '100 days'),
    (9301002, v_pii, 'bad', 'recent failure', now() - interval '5 days', now() - interval '5 days');

  -- A ledger row still queued after the whole period, with no deliveries.
  INSERT INTO public.domain_event_ledger (
    domain_event_id, producer, trust_level, idempotency_key, event_name,
    subject_type, subject_id, envelope, status, created_at, queue_message_id
  ) VALUES (
    v_old_queued, 'sql-retention', 'server', 'retention-' || v_old_queued::text,
    'analytics.add_to_cart.v1', 'event', v_old_queued::text, v_pii, 'queued',
    now() - interval '100 days', 9302001
  );
  INSERT INTO pgmq.q_domain_events (msg_id, enqueued_at, vt, message)
  VALUES (9302001, now() - interval '100 days', now(), v_pii);
  -- Archived late (recent archived_at) but the event itself is 100 days old.
  INSERT INTO pgmq.a_domain_events (msg_id, enqueued_at, archived_at, message)
  VALUES (9302002, now() - interval '100 days', now() - interval '1 day', v_pii);

  -- Failure first seen long ago but failing again recently: kept.
  INSERT INTO public.domain_event_failures (
    queue_message_id, original_envelope, failure_code, failure_message,
    first_failed_at, last_failed_at
  ) VALUES (9301003, v_pii, 'bad', 'old but refailing', now() - interval '100 days', now() - interval '5 days');

  -- A row minimised at ingest (consent flags only) carries no personal data
  -- and is left untouched.
  INSERT INTO public.domain_event_ledger (
    domain_event_id, producer, trust_level, idempotency_key, event_name,
    subject_type, subject_id, envelope, status, created_at
  ) VALUES (
    '00000000-0000-4000-8000-00000000e105', 'sql-retention', 'server',
    'retention-e105', 'analytics.page_view.v1', 'event', 'e105',
    jsonb_build_object('data', jsonb_build_object(
      'delivery_user_data',
      jsonb_build_object('analytics_consent', false, 'marketing_consent', false))),
    'routed', now() - interval '100 days'
  );

  -- An old row whose block never had the consent flags keeps explicit false flags.
  INSERT INTO public.domain_event_ledger (
    domain_event_id, producer, trust_level, idempotency_key, event_name,
    subject_type, subject_id, envelope, status, created_at
  ) VALUES (
    '00000000-0000-4000-8000-00000000e106', 'sql-retention', 'server',
    'retention-e106', 'analytics.add_to_cart.v1', 'event', 'e106',
    jsonb_build_object('data', jsonb_build_object(
      'delivery_user_data', jsonb_build_object('ip', '203.0.113.9'))),
    'routed', now() - interval '100 days'
  );

  PERFORM * FROM public.cleanup_domain_event_pipeline_v1();

  IF (SELECT envelope FROM public.domain_event_ledger
      WHERE domain_event_id = '00000000-0000-4000-8000-00000000e106')
       #>> '{data,delivery_user_data,marketing_consent}' IS DISTINCT FROM 'false'
     OR (SELECT envelope FROM public.domain_event_ledger
      WHERE domain_event_id = '00000000-0000-4000-8000-00000000e106')
       #> '{data,delivery_user_data,ip}' IS NOT NULL THEN
    RAISE EXCEPTION 'missing consent flags were not defaulted to false, or ip kept';
  END IF;

  IF (SELECT envelope FROM public.domain_event_ledger
      WHERE domain_event_id = '00000000-0000-4000-8000-00000000e105')
       #>> '{data,delivery_user_data,analytics_consent}' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'minimised row was rewritten by the scrub';
  END IF;

  IF (SELECT envelope FROM public.domain_event_ledger WHERE domain_event_id = v_old_done)
       #>> '{data,delivery_user_data,analytics_consent}' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'scrub removed the consent flags it should keep';
  END IF;
  IF (SELECT envelope FROM public.domain_event_ledger WHERE domain_event_id = v_old_queued)
       #> '{data,delivery_user_data,ip}' IS NOT NULL THEN
    RAISE EXCEPTION 'old queued ledger row kept personal data';
  END IF;
  IF (SELECT message FROM pgmq.q_domain_events WHERE msg_id = 9302001)
       #> '{data,delivery_user_data,ip}' IS NOT NULL THEN
    RAISE EXCEPTION 'old queue message copy kept personal data';
  END IF;
  IF (SELECT message FROM pgmq.a_domain_events WHERE msg_id = 9302002)
       #> '{data,delivery_user_data,ip}' IS NOT NULL THEN
    RAISE EXCEPTION 'late-archived envelope kept personal data';
  END IF;
  IF (SELECT envelope FROM public.domain_event_ledger WHERE domain_event_id = v_old_done)
       #> '{data,event_data,user_agent}' IS NOT NULL
     OR (SELECT envelope FROM public.domain_event_ledger WHERE domain_event_id = v_old_done)
       #>> '{data,event_data,session_id}' IS DISTINCT FROM 's1' THEN
    RAISE EXCEPTION 'user agent not scrubbed, or scrub removed more than the user agent';
  END IF;
  IF (SELECT original_envelope FROM public.domain_event_failures WHERE queue_message_id = 9301003)
       #> '{data,delivery_user_data}' IS NULL THEN
    RAISE EXCEPTION 'recently failing row lost its personal data early';
  END IF;

  -- Old + finished: scrubbed in ledger and delivery, rest of the row kept.
  IF (SELECT envelope FROM public.domain_event_ledger WHERE domain_event_id = v_old_done)
       #> '{data,delivery_user_data,ip}' IS NOT NULL THEN
    RAISE EXCEPTION 'old finished ledger row kept personal data';
  END IF;
  IF (SELECT envelope FROM public.domain_event_ledger WHERE domain_event_id = v_old_done)
       #>> '{data,event_type}' IS DISTINCT FROM 'add_to_cart' THEN
    RAISE EXCEPTION 'scrub removed more than the personal block';
  END IF;
  IF (SELECT payload FROM public.event_deliveries WHERE domain_event_id = v_old_done)
       #> '{data,delivery_user_data,ip}' IS NOT NULL THEN
    RAISE EXCEPTION 'old finished delivery payload kept personal data';
  END IF;

  -- Old but still retrying: untouched.
  IF (SELECT payload FROM public.event_deliveries WHERE domain_event_id = v_old_open)
       #> '{data,delivery_user_data}' IS NULL
     OR (SELECT envelope FROM public.domain_event_ledger WHERE domain_event_id = v_old_open)
       #> '{data,delivery_user_data}' IS NULL THEN
    RAISE EXCEPTION 'unfinished delivery work lost its personal data early';
  END IF;

  -- Recent: untouched.
  IF (SELECT payload FROM public.event_deliveries WHERE domain_event_id = v_recent)
       #> '{data,delivery_user_data}' IS NULL
     OR (SELECT envelope FROM public.domain_event_ledger WHERE domain_event_id = v_recent)
       #> '{data,delivery_user_data}' IS NULL THEN
    RAISE EXCEPTION 'recent rows lost their personal data early';
  END IF;

  -- Failure rows follow the same age rule.
  IF (SELECT original_envelope FROM public.domain_event_failures WHERE queue_message_id = 9301001)
       #> '{data,delivery_user_data,ip}' IS NOT NULL THEN
    RAISE EXCEPTION 'old failure row kept personal data';
  END IF;
  IF (SELECT original_envelope FROM public.domain_event_failures WHERE queue_message_id = 9301002)
       #> '{data,delivery_user_data}' IS NULL THEN
    RAISE EXCEPTION 'recent failure row lost its personal data early';
  END IF;

  -- Partial indexes keep the daily scrub from rescanning cleaned rows.
  IF (SELECT count(*) FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_event_deliveries_personal_data_created',
          'idx_domain_event_ledger_personal_data_created',
          'idx_domain_event_failures_personal_data_failed')) <> 3 THEN
    RAISE EXCEPTION 'personal-data partial indexes missing';
  END IF;
END;
$$ LANGUAGE plpgsql;

ROLLBACK;

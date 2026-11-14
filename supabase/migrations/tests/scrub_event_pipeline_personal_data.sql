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
      'delivery_user_data', jsonb_build_object('ip', '203.0.113.1', 'email', 'a@example.com')
    )
  );
  v_old_done uuid := '00000000-0000-4000-8000-00000000e101';
  v_old_open uuid := '00000000-0000-4000-8000-00000000e102';
  v_recent uuid := '00000000-0000-4000-8000-00000000e103';
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

  PERFORM * FROM public.cleanup_domain_event_pipeline_v1();

  -- Old + finished: scrubbed in ledger and delivery, rest of the row kept.
  IF (SELECT envelope FROM public.domain_event_ledger WHERE domain_event_id = v_old_done)
       #> '{data,delivery_user_data}' IS NOT NULL THEN
    RAISE EXCEPTION 'old finished ledger row kept personal data';
  END IF;
  IF (SELECT envelope FROM public.domain_event_ledger WHERE domain_event_id = v_old_done)
       #>> '{data,event_type}' IS DISTINCT FROM 'add_to_cart' THEN
    RAISE EXCEPTION 'scrub removed more than the personal block';
  END IF;
  IF (SELECT payload FROM public.event_deliveries WHERE domain_event_id = v_old_done)
       #> '{data,delivery_user_data}' IS NOT NULL THEN
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
       #> '{data,delivery_user_data}' IS NOT NULL THEN
    RAISE EXCEPTION 'old failure row kept personal data';
  END IF;
  IF (SELECT original_envelope FROM public.domain_event_failures WHERE queue_message_id = 9301002)
       #> '{data,delivery_user_data}' IS NULL THEN
    RAISE EXCEPTION 'recent failure row lost its personal data early';
  END IF;
END;
$$ LANGUAGE plpgsql;

ROLLBACK;

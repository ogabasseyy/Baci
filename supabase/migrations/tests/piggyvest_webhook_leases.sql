BEGIN;

INSERT INTO public.piggyvest_webhook_inbox
  (event_id, event_type, event_category, customer_id, status, updated_at)
VALUES
  ('lease-test-pending', 'interest-payout.success', 'interest-payout', 'lease-customer', 'pending', clock_timestamp()),
  ('lease-test-legacy-stale', 'interest-payout.success', 'interest-payout', 'lease-customer', 'processing', clock_timestamp() - interval '3 minutes'),
  ('lease-test-legacy-fresh', 'interest-payout.success', 'interest-payout', 'lease-customer', 'processing', clock_timestamp());

DO $$
DECLARE
  function_id regprocedure;
BEGIN
  FOREACH function_id IN ARRAY ARRAY[
    'public.claim_piggyvest_webhook_event(text)'::regprocedure,
    'public.resolve_piggyvest_webhook_event(text,uuid,text,text)'::regprocedure
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = function_id AND prosecdef) THEN
      RAISE EXCEPTION 'Lease RPC must be security invoker';
    END IF;
    IF has_function_privilege('anon', function_id, 'EXECUTE')
      OR has_function_privilege('authenticated', function_id, 'EXECUTE')
      OR NOT has_function_privilege('service_role', function_id, 'EXECUTE') THEN
      RAISE EXCEPTION 'Lease RPC grants are not service-role only';
    END IF;
  END LOOP;
  IF has_table_privilege('service_role', 'public.piggyvest_webhook_inbox', 'DELETE')
    OR has_table_privilege('service_role', 'public.piggyvest_webhook_inbox', 'TRUNCATE')
    OR has_column_privilege('service_role', 'public.piggyvest_webhook_inbox', 'customer_id', 'UPDATE') THEN
    RAISE EXCEPTION 'Inbox grants exceed required permissions';
  END IF;
END;
$$;

SET LOCAL ROLE service_role;

INSERT INTO public.piggyvest_webhook_inbox
  (event_id, event_type, event_category, customer_id, status)
VALUES ('lease-test-pending', 'interest-payout.success', 'interest-payout', 'lease-customer', 'pending')
ON CONFLICT (event_id) DO NOTHING
RETURNING event_id;

DO $$
DECLARE
  result jsonb;
  first_token uuid;
  next_token uuid;
  attempt_count integer;
  lease_end timestamptz;
  database_before timestamptz;
BEGIN
  database_before := clock_timestamp();
  result := public.claim_piggyvest_webhook_event('lease-test-pending');
  first_token := (result->>'claim_token')::uuid;
  IF result->>'outcome' <> 'claimed' OR first_token IS NULL THEN
    RAISE EXCEPTION 'Pending event did not receive ownership';
  END IF;
  SELECT attempts, lease_expires_at INTO attempt_count, lease_end
  FROM public.piggyvest_webhook_inbox WHERE event_id = 'lease-test-pending';
  IF attempt_count <> 1 OR lease_end < database_before + interval '2 minutes'
    OR lease_end > clock_timestamp() + interval '2 minutes' THEN
    RAISE EXCEPTION 'Claim must increment attempts and use the database clock';
  END IF;
  result := public.claim_piggyvest_webhook_event('lease-test-pending');
  IF result->>'outcome' <> 'busy' OR result->>'claim_token' IS NOT NULL THEN
    RAISE EXCEPTION 'Active lease must be busy without disclosing ownership';
  END IF;
  IF public.resolve_piggyvest_webhook_event('lease-test-pending', gen_random_uuid(), 'processed') THEN
    RAISE EXCEPTION 'Wrong token completed active work';
  END IF;
  UPDATE public.piggyvest_webhook_inbox
  SET lease_expires_at = clock_timestamp() - interval '1 second'
  WHERE event_id = 'lease-test-pending';
  IF public.resolve_piggyvest_webhook_event('lease-test-pending', first_token, 'processed')
    OR public.resolve_piggyvest_webhook_event('lease-test-pending', first_token, 'failed') THEN
    RAISE EXCEPTION 'Expired ownership resolved work';
  END IF;
  result := public.claim_piggyvest_webhook_event('lease-test-pending');
  next_token := (result->>'claim_token')::uuid;
  IF result->>'outcome' <> 'claimed' OR next_token IS NULL OR next_token = first_token THEN
    RAISE EXCEPTION 'Stale processing did not rotate ownership';
  END IF;
  IF public.resolve_piggyvest_webhook_event('lease-test-pending', first_token, 'processed')
    OR public.resolve_piggyvest_webhook_event('lease-test-pending', first_token, 'failed') THEN
    RAISE EXCEPTION 'Former worker resolved newer ownership';
  END IF;
  SELECT attempts INTO attempt_count FROM public.piggyvest_webhook_inbox
  WHERE event_id = 'lease-test-pending' AND claim_token = next_token AND status = 'processing';
  IF attempt_count IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'Busy or stale completion mutated attempts or ownership';
  END IF;
  IF NOT public.resolve_piggyvest_webhook_event('lease-test-pending', next_token, 'failed', 'storage unavailable') THEN
    RAISE EXCEPTION 'Current owner could not release failed work';
  END IF;
  result := public.claim_piggyvest_webhook_event('lease-test-pending');
  next_token := (result->>'claim_token')::uuid;
  IF result->>'outcome' <> 'claimed' OR next_token IS NULL THEN
    RAISE EXCEPTION 'Failed work was not retryable';
  END IF;
  IF NOT public.resolve_piggyvest_webhook_event('lease-test-pending', next_token, 'processed') THEN
    RAISE EXCEPTION 'Current owner could not complete work';
  END IF;
  IF public.resolve_piggyvest_webhook_event('lease-test-pending', next_token, 'failed') THEN
    RAISE EXCEPTION 'Completed work was overwritten';
  END IF;
  result := public.claim_piggyvest_webhook_event('lease-test-pending');
  IF result->>'outcome' <> 'processed' OR result->>'claim_token' IS NOT NULL THEN
    RAISE EXCEPTION 'Completed work was not explicitly distinguished';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.piggyvest_webhook_inbox WHERE event_id = 'lease-test-pending'
      AND attempts = 3 AND claim_token IS NULL AND lease_expires_at IS NULL
      AND processed_at IS NOT NULL AND last_error IS NULL
  ) THEN
    RAISE EXCEPTION 'Completion did not clear ownership and error';
  END IF;
  result := public.claim_piggyvest_webhook_event('lease-test-legacy-stale');
  IF result->>'outcome' <> 'claimed' OR result->>'claim_token' IS NULL THEN
    RAISE EXCEPTION 'Stale legacy work without lease was not reclaimed';
  END IF;
  result := public.claim_piggyvest_webhook_event('lease-test-legacy-fresh');
  IF result->>'outcome' <> 'busy' THEN
    RAISE EXCEPTION 'Fresh legacy work must receive a grace period';
  END IF;
  BEGIN
    PERFORM public.claim_piggyvest_webhook_event('lease-test-missing');
    RAISE EXCEPTION 'Missing work was acknowledged';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.resolve_piggyvest_webhook_event('lease-test-pending', next_token, 'processing');
    RAISE EXCEPTION 'Invalid terminal state accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END;
$$;

SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.claim_piggyvest_webhook_event('lease-test-pending');
    RAISE EXCEPTION 'Anonymous caller claimed work';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.resolve_piggyvest_webhook_event('lease-test-pending', gen_random_uuid(), 'processed');
    RAISE EXCEPTION 'Authenticated caller resolved work';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

ROLLBACK;

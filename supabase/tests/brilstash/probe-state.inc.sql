SET LOCAL ROLE authenticated;
DO $$
DECLARE installation uuid := '30000000-0000-4000-8000-000000000001';
DECLARE state jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
  state := public.inspect_brilstash_probe_state(installation);
  IF state->>'generationId' IS DISTINCT FROM '70000000-0000-4000-8000-000000000001'
    OR state->>'totalCount' IS DISTINCT FROM '1'
    OR state->>'credentialId' IS NULL
    OR state->>'payloadDigest' IS NULL
  THEN RAISE EXCEPTION 'probe state did not identify the approved feed'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
  BEGIN
    PERFORM public.inspect_brilstash_probe_state(installation);
    RAISE EXCEPTION 'builder can inspect probe state';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
END $$;
RESET ROLE;
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.inspect_brilstash_probe_state(uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.inspect_brilstash_probe_state(uuid)', 'EXECUTE')
  THEN RAISE EXCEPTION 'unapproved role can inspect probe state'; END IF;
END $$;

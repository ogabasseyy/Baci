\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', true);
SET LOCAL ROLE authenticated;
SELECT public.create_connector_grant_for_request(
  '11111111-1111-4111-8111-111111111111', 'mcn_request_regression',
  ARRAY['44444444-4444-4444-a444-444444444444']::uuid[], ARRAY['orders:read'],
  false, NULL, repeat('c',64), repeat('d',64), repeat('e',64)
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.connector_grants
    WHERE connection_id='mcn_request_regression' AND request_fingerprint=repeat('e',64)) THEN
    RAISE EXCEPTION 'request fingerprint was not persisted atomically or is not readable';
  END IF;
  BEGIN
    PERFORM public.create_connector_grant_for_request(
      '11111111-1111-4111-8111-111111111111', 'mcn_request_invalid',
      '{}'::uuid[], ARRAY['orders:read'], true, NULL, repeat('1',64), repeat('2',64), NULL
    );
    RAISE EXCEPTION 'accepted null request fingerprint';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid_connector_grant' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.connector_grants WHERE connection_id='mcn_request_invalid') THEN
    RAISE EXCEPTION 'invalid request left a grant';
  END IF;
  BEGIN
    PERFORM public.create_connector_grant_for_request(
      '22222222-2222-4222-8222-222222222222', 'mcn_request_foreign',
      '{}'::uuid[], ARRAY['orders:read'], true, NULL, repeat('1',64), repeat('2',64), repeat('3',64)
    );
    RAISE EXCEPTION 'accepted another merchants owner';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;
DO $$
BEGIN
  IF has_function_privilege('anon',
    'public.create_connector_grant_for_request(uuid,text,uuid[],text[],boolean,timestamptz,text,text,text)', 'EXECUTE')
  THEN RAISE EXCEPTION 'anonymous caller can issue grants'; END IF;
END;
$$;
ROLLBACK;

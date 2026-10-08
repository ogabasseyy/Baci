\set ON_ERROR_STOP on

DO $$
DECLARE
  role_name text;
  function_oid oid;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
    WHERE oid = 'piggyvest_staging.inbox'::regclass) THEN
    RAISE EXCEPTION 'RLS must be enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid = 'piggyvest_staging.inbox'::regclass) THEN
    RAISE EXCEPTION 'inbox must be default deny';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'inbox_test_untrusted'] LOOP
    IF pg_catalog.has_schema_privilege(role_name, 'piggyvest_staging', 'USAGE')
      OR pg_catalog.has_table_privilege(role_name, 'piggyvest_staging.inbox', 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'unexpected access: %', role_name;
    END IF;
    FOR function_oid IN SELECT oid FROM pg_catalog.pg_proc
      WHERE pronamespace = 'piggyvest_staging'::regnamespace LOOP
      IF pg_catalog.has_function_privilege(role_name, function_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'unexpected execute: %', role_name;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc
    WHERE pronamespace = 'piggyvest_staging'::regnamespace
      AND (NOT prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'])) THEN
    RAISE EXCEPTION 'functions require fixed search path and security definer';
  END IF;
END $$;

GRANT USAGE ON SCHEMA piggyvest_staging TO inbox_test_worker, inbox_test_untrusted;
GRANT EXECUTE ON FUNCTION piggyvest_staging.enqueue_inbox(uuid, text, bytea) TO inbox_test_worker;
GRANT EXECUTE ON FUNCTION piggyvest_staging.claim_inbox(uuid, integer, integer) TO inbox_test_worker;
GRANT EXECUTE ON FUNCTION piggyvest_staging.finish_inbox(uuid, uuid, uuid, text, integer) TO inbox_test_worker;

SET ROLE inbox_test_untrusted;
DO $$
BEGIN
  BEGIN
    PERFORM piggyvest_staging.enqueue_inbox('11111111-1111-4111-8111-111111111111', 'denied', '\x00');
    RAISE EXCEPTION 'untrusted execute allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM piggyvest_staging.claim_inbox('11111111-1111-4111-8111-111111111111', 1, 30);
    RAISE EXCEPTION 'untrusted claim allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM piggyvest_staging.finish_inbox('11111111-1111-4111-8111-111111111111',
      pg_catalog.gen_random_uuid(), pg_catalog.gen_random_uuid(), 'processed', 0);
    RAISE EXCEPTION 'untrusted finish allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET ROLE inbox_test_worker;
DO $$
DECLARE
  integration uuid := '11111111-1111-4111-8111-111111111111';
  first_id uuid;
  result record;
  bad_body bytea;
  bad_event text;
BEGIN
  BEGIN
    PERFORM 1 FROM piggyvest_staging.inbox;
    RAISE EXCEPTION 'direct table read allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM piggyvest_staging.inbox;
    RAISE EXCEPTION 'direct table write allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM piggyvest_staging.integrations;
    RAISE EXCEPTION 'direct registry read allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE piggyvest_staging.integrations SET enabled = true;
    RAISE EXCEPTION 'worker registry provisioning allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT inbox_id, outcome INTO result FROM piggyvest_staging.enqueue_inbox(integration, 'same', '\x00ff');
  first_id := result.inbox_id;
  IF result.outcome <> 'accepted' THEN RAISE EXCEPTION 'enqueue failed'; END IF;
  SELECT inbox_id, outcome INTO result FROM piggyvest_staging.enqueue_inbox(integration, 'same', '\x00ff');
  IF result.outcome <> 'duplicate' OR result.inbox_id <> first_id THEN RAISE EXCEPTION 'duplicate failed'; END IF;
  SELECT inbox_id, outcome INTO result FROM piggyvest_staging.enqueue_inbox(integration, 'same', '\x00fe');
  IF result.outcome <> 'conflict' OR result.inbox_id <> first_id THEN RAISE EXCEPTION 'conflict failed'; END IF;
  SELECT inbox_id, outcome INTO result FROM piggyvest_staging.enqueue_inbox(
    '22222222-2222-4222-8222-222222222222', 'same', '\x00fe');
  IF result.outcome <> 'accepted' OR result.inbox_id = first_id THEN RAISE EXCEPTION 'integration isolation failed'; END IF;
  PERFORM piggyvest_staging.enqueue_inbox(integration, repeat('x', 512), decode(repeat('00', 65536), 'hex'));
  FOREACH bad_body IN ARRAY ARRAY[NULL::bytea, decode(repeat('00', 65537), 'hex')] LOOP
    BEGIN
      PERFORM piggyvest_staging.enqueue_inbox(integration, 'invalid-body', bad_body);
      RAISE EXCEPTION 'invalid body accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
  FOREACH bad_event IN ARRAY ARRAY[NULL::text, '', repeat('x', 513)] LOOP
    BEGIN
      PERFORM piggyvest_staging.enqueue_inbox(integration, bad_event, '\x');
      RAISE EXCEPTION 'invalid event accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM piggyvest_staging.enqueue_inbox(NULL, 'missing-integration', '\x');
    RAISE EXCEPTION 'null integration accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT raw_body FROM piggyvest_staging.inbox WHERE integration_id = '11111111-1111-4111-8111-111111111111'
    AND provider_event_id = 'same') IS DISTINCT FROM '\x00ff'::bytea THEN
    RAISE EXCEPTION 'conflict overwrote body';
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_staging.inbox WHERE fingerprint <> pg_catalog.sha256(raw_body)) THEN
    RAISE EXCEPTION 'fingerprint mismatch';
  END IF;
  IF (SELECT count(*) FROM piggyvest_staging.inbox) <> 3 THEN
    RAISE EXCEPTION 'invalid enqueue must not persist';
  END IF;
END $$;
TRUNCATE piggyvest_staging.inbox;

BEGIN;
SET LOCAL ROLE inbox_test_worker;
DO $$
BEGIN
  PERFORM piggyvest_staging.enqueue_inbox('11111111-1111-4111-8111-111111111111', 'rollback', '\x');
END $$;
ROLLBACK;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM piggyvest_staging.inbox) THEN
    RAISE EXCEPTION 'enqueue escaped transaction rollback';
  END IF;
END $$;

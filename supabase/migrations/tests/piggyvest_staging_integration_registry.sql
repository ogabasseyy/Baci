\set ON_ERROR_STOP on

DO $$
DECLARE
  role_name text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
    WHERE oid = 'piggyvest_staging.integrations'::regclass) THEN
    RAISE EXCEPTION 'registry RLS required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid = 'piggyvest_staging.integrations'::regclass) THEN
    RAISE EXCEPTION 'registry default deny required';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'inbox_test_worker', 'inbox_test_untrusted'] LOOP
    IF pg_catalog.has_table_privilege(role_name, 'piggyvest_staging.integrations', 'SELECT,INSERT,UPDATE,DELETE')
      THEN RAISE EXCEPTION 'registry access: %', role_name; END IF;
  END LOOP;
END $$;

INSERT INTO piggyvest_staging.integrations (id, expected_provider_account_id, enabled) VALUES
  ('11111111-1111-4111-8111-111111111111', 'synthetic-account-one', true),
  ('22222222-2222-4222-8222-222222222222', 'synthetic-account-two', true),
  ('33333333-3333-4333-8333-333333333333', 'synthetic-account-concurrent', true);
INSERT INTO piggyvest_staging.integrations (id, expected_provider_account_id) VALUES
  ('44444444-4444-4444-8444-444444444444', 'synthetic-disabled');

DO $$
DECLARE
  integration uuid;
  claim record;
BEGIN
  IF (SELECT enabled FROM piggyvest_staging.integrations WHERE expected_provider_account_id = 'synthetic-disabled')
    THEN RAISE EXCEPTION 'registry enabled by default'; END IF;
  BEGIN
    INSERT INTO piggyvest_staging.integrations (expected_provider_account_id) VALUES ('synthetic-account-one');
    RAISE EXCEPTION 'duplicate configured account accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO piggyvest_staging.inbox (integration_id, provider_event_id, raw_body)
      VALUES ('55555555-5555-4555-8555-555555555555', 'orphan', '\x');
    RAISE EXCEPTION 'missing registry FK';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  FOREACH integration IN ARRAY ARRAY['44444444-4444-4444-8444-444444444444'::uuid,
    '55555555-5555-4555-8555-555555555555'::uuid] LOOP
    BEGIN
      PERFORM piggyvest_staging.enqueue_inbox(integration, 'disabled', '\x');
      RAISE EXCEPTION 'unconfigured integration accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    IF EXISTS (SELECT 1 FROM piggyvest_staging.claim_inbox(integration, 1, 30))
      THEN RAISE EXCEPTION 'unconfigured claim'; END IF;
  END LOOP;
  integration := '11111111-1111-4111-8111-111111111111';
  PERFORM piggyvest_staging.enqueue_inbox(integration, 'disable-after-claim', '\x');
  SELECT * INTO STRICT claim FROM piggyvest_staging.claim_inbox(integration, 1, 30);
  PERFORM piggyvest_staging.enqueue_inbox(integration, 'disable-before-claim', '\x');
  UPDATE piggyvest_staging.integrations SET enabled = false WHERE id = integration;
  IF EXISTS (SELECT 1 FROM piggyvest_staging.claim_inbox(integration, 1, 30))
    THEN RAISE EXCEPTION 'disabled integration claimed queued event'; END IF;
  IF piggyvest_staging.finish_inbox(integration, claim.inbox_id, claim.claim_token, 'unsupported', 0) <> 'stale'
    THEN RAISE EXCEPTION 'disabled integration finished'; END IF;
  UPDATE piggyvest_staging.integrations SET enabled = true WHERE id = integration;
END $$;
TRUNCATE piggyvest_staging.inbox;

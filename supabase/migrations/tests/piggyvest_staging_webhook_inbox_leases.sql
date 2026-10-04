\set ON_ERROR_STOP on

SET ROLE inbox_test_worker;
DO $$
DECLARE
  integration uuid := '11111111-1111-4111-8111-111111111111';
  claim record;
  bad_number integer;
  bad_outcome text;
BEGIN
  PERFORM piggyvest_staging.enqueue_inbox(integration, 'lease', '\x01');
  PERFORM piggyvest_staging.enqueue_inbox('22222222-2222-4222-8222-222222222222', 'lease', '\x02');
  SELECT * INTO STRICT claim FROM piggyvest_staging.claim_inbox(integration, 1, 30);
  IF claim.attempts <> 1 OR claim.raw_body <> '\x01'::bytea
    OR claim.fingerprint <> pg_catalog.sha256('\x01'::bytea) OR claim.claim_token IS NULL THEN
    RAISE EXCEPTION 'invalid initial claim';
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_staging.claim_inbox(integration, 1, 30)) THEN
    RAISE EXCEPTION 'active lease reclaimed';
  END IF;
  IF piggyvest_staging.finish_inbox('22222222-2222-4222-8222-222222222222', claim.inbox_id,
    claim.claim_token, 'unsupported', 0) <> 'stale' THEN RAISE EXCEPTION 'cross integration finish'; END IF;
  IF piggyvest_staging.finish_inbox(integration, claim.inbox_id, pg_catalog.gen_random_uuid(),
    'unsupported', 0) <> 'stale' THEN RAISE EXCEPTION 'wrong token accepted'; END IF;
  FOREACH bad_outcome IN ARRAY ARRAY[NULL::text, 'processed', 'credit', 'quarantined', ''] LOOP
    BEGIN
      PERFORM piggyvest_staging.finish_inbox(integration, claim.inbox_id, claim.claim_token, bad_outcome, 0);
      RAISE EXCEPTION 'invalid outcome accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
  FOREACH bad_number IN ARRAY ARRAY[NULL::integer, -1, 3601] LOOP
    BEGIN
      PERFORM piggyvest_staging.finish_inbox(integration, claim.inbox_id, claim.claim_token, 'retry', bad_number);
      RAISE EXCEPTION 'invalid retry accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
  IF piggyvest_staging.finish_inbox(integration, claim.inbox_id, claim.claim_token, 'retry', 3600) <> 'pending'
    THEN RAISE EXCEPTION 'retry failed'; END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_staging.claim_inbox(integration, 1, 30)) THEN
    RAISE EXCEPTION 'retry delay ignored';
  END IF;
  FOREACH bad_number IN ARRAY ARRAY[NULL::integer, 0, 101] LOOP
    BEGIN
      PERFORM piggyvest_staging.claim_inbox(integration, bad_number, 30);
      RAISE EXCEPTION 'invalid batch accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
  FOREACH bad_number IN ARRAY ARRAY[NULL::integer, 0, 301] LOOP
    BEGIN
      PERFORM piggyvest_staging.claim_inbox(integration, 1, bad_number);
      RAISE EXCEPTION 'invalid lease accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
END $$;
RESET ROLE;

UPDATE piggyvest_staging.inbox SET available_at = pg_catalog.clock_timestamp() - interval '1 second';
CREATE TEMP TABLE old_claim AS
  SELECT inbox_id, claim_token FROM piggyvest_staging.claim_inbox('11111111-1111-4111-8111-111111111111', 1, 1);
UPDATE piggyvest_staging.inbox SET lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
  WHERE status = 'leased';
GRANT SELECT ON old_claim TO inbox_test_worker;
SET ROLE inbox_test_worker;
DO $$
DECLARE
  integration uuid := '11111111-1111-4111-8111-111111111111';
  previous record;
  current_claim record;
BEGIN
  SELECT inbox_id, claim_token INTO STRICT previous FROM old_claim;
  IF piggyvest_staging.finish_inbox(integration, previous.inbox_id, previous.claim_token, 'unsupported', 0) <> 'stale'
    THEN RAISE EXCEPTION 'expired lease finished'; END IF;
  SELECT * INTO STRICT current_claim FROM piggyvest_staging.claim_inbox(integration, 1, 300);
  IF current_claim.claim_token = previous.claim_token OR current_claim.attempts <> 3
    THEN RAISE EXCEPTION 'reclaim did not fence'; END IF;
  IF piggyvest_staging.finish_inbox(integration, previous.inbox_id, previous.claim_token, 'unsupported', 0) <> 'stale'
    THEN RAISE EXCEPTION 'stale worker finished new lease'; END IF;
  IF piggyvest_staging.finish_inbox(integration, current_claim.inbox_id, current_claim.claim_token, 'unsupported', 0)
    <> 'quarantined' THEN RAISE EXCEPTION 'unsupported event not quarantined'; END IF;
  IF piggyvest_staging.finish_inbox(integration, current_claim.inbox_id, current_claim.claim_token, 'unsupported', 0)
    <> 'stale' THEN RAISE EXCEPTION 'terminal event finished twice'; END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_staging.claim_inbox(integration, 1, 30))
    THEN RAISE EXCEPTION 'quarantine reclaimed'; END IF;
END $$;
RESET ROLE;
TRUNCATE piggyvest_staging.inbox;

SET ROLE inbox_test_worker;
DO $$
DECLARE
  integration uuid := '11111111-1111-4111-8111-111111111111';
  event_number integer;
BEGIN
  FOR event_number IN 1..101 LOOP
    PERFORM piggyvest_staging.enqueue_inbox(integration, 'batch-' || event_number::text, '\x');
  END LOOP;
  IF (SELECT count(*) FROM piggyvest_staging.claim_inbox(integration, 100, 30)) <> 100
    THEN RAISE EXCEPTION 'batch did not respect upper bound'; END IF;
  IF (SELECT count(*) FROM piggyvest_staging.claim_inbox(integration, 100, 30)) <> 1
    THEN RAISE EXCEPTION 'batch did not leave remaining event'; END IF;
  BEGIN
    PERFORM piggyvest_staging.claim_inbox(NULL, 1, 30);
    RAISE EXCEPTION 'null claim integration accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;
RESET ROLE;
TRUNCATE piggyvest_staging.inbox;

SET ROLE inbox_test_worker;
DO $$
DECLARE
  integration uuid := '11111111-1111-4111-8111-111111111111';
  claim record;
  attempt integer;
  result text;
BEGIN
  PERFORM piggyvest_staging.enqueue_inbox(integration, 'retry-cap', '\x');
  FOR attempt IN 1..5 LOOP
    SELECT * INTO STRICT claim FROM piggyvest_staging.claim_inbox(integration, 1, 30);
    IF claim.attempts <> attempt THEN RAISE EXCEPTION 'incorrect attempts'; END IF;
    result := piggyvest_staging.finish_inbox(integration, claim.inbox_id, claim.claim_token, 'retry', 0);
    IF result <> (CASE WHEN attempt = 5 THEN 'dead_letter' ELSE 'pending' END)
      THEN RAISE EXCEPTION 'incorrect retry cap result'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM piggyvest_staging.claim_inbox(integration, 100, 30))
    THEN RAISE EXCEPTION 'dead letter reclaimed'; END IF;
  PERFORM piggyvest_staging.enqueue_inbox(integration, 'quarantined', '\x');
  SELECT * INTO STRICT claim FROM piggyvest_staging.claim_inbox(integration, 1, 30);
  IF piggyvest_staging.finish_inbox(integration, claim.inbox_id, claim.claim_token, 'unsupported', 0) <> 'quarantined'
    THEN RAISE EXCEPTION 'completion failed'; END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_staging.claim_inbox(integration, 1, 30))
    THEN RAISE EXCEPTION 'quarantined reclaimed'; END IF;
END $$;
RESET ROLE;

DO $$
DECLARE
  integration uuid := '11111111-1111-4111-8111-111111111111';
  attempt integer;
BEGIN
  PERFORM piggyvest_staging.enqueue_inbox(integration, 'crash-cap', '\x');
  FOR attempt IN 1..5 LOOP
    IF (SELECT attempts FROM piggyvest_staging.claim_inbox(integration, 1, 30)) IS DISTINCT FROM attempt
      THEN RAISE EXCEPTION 'crash attempt failed'; END IF;
    UPDATE piggyvest_staging.inbox SET lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
      WHERE provider_event_id = 'crash-cap';
  END LOOP;
  IF EXISTS (SELECT 1 FROM piggyvest_staging.claim_inbox(integration, 1, 30))
    THEN RAISE EXCEPTION 'exhausted crash reclaimed'; END IF;
  IF (SELECT status FROM piggyvest_staging.inbox WHERE provider_event_id = 'crash-cap') <> 'dead_letter'
    THEN RAISE EXCEPTION 'exhausted crash not dead lettered'; END IF;
END $$;
TRUNCATE piggyvest_staging.inbox;

DO $$
DECLARE session_zone text;
DECLARE initial_zone text := current_setting('TimeZone');
BEGIN
  FOREACH session_zone IN ARRAY ARRAY['UTC', 'Africa/Lagos'] LOOP
    PERFORM set_config('TimeZone', session_zone, true);
    IF private.brilstash_scheduled_pull_end('2026-11-19', 1200)
      IS DISTINCT FROM timestamptz '2026-11-19 23:19:10+00'
    THEN RAISE EXCEPTION 'scheduled pull deadline changed in session zone %', session_zone; END IF;
  END LOOP;
  PERFORM set_config('TimeZone', initial_zone, true);
END $$;
-- Test policy and candidate only; the live policy requires confirmed partner timings.
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.configure_brilstash_drain_policy(
    '30000000-0000-4000-8000-000000000001', 5300, 120, NULL, 'Too long for the window'
  );
  RAISE EXCEPTION 'a drain budget longer than the promotion window was accepted';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
SELECT public.configure_brilstash_drain_policy(
  '30000000-0000-4000-8000-000000000001', 1200, 120, NULL, 'Fixture drain protocol'
);
RESET ROLE;
DO $$
DECLARE installation uuid := '30000000-0000-4000-8000-000000000001';
BEGIN
  IF private.brilstash_read_is_fresh(installation, '2026-11-18 22:00:00+01', '2026-11-19 23:59:00+01')
    OR private.brilstash_read_is_fresh(installation, '2026-11-18 22:00:00+01', '2026-11-19 23:30:00+01')
    OR NOT private.brilstash_read_is_fresh(installation, '2026-11-19 22:00:00+01', '2026-11-19 23:59:00+01')
    OR NOT private.brilstash_read_is_fresh(installation, '2026-11-18 22:00:00+01', '2026-11-19 20:00:00+01')
    OR private.brilstash_read_is_fresh(installation, '2026-11-18 22:00:00+01', '2026-11-20 00:00:00+01')
    OR private.brilstash_read_is_fresh(installation, '2026-11-19 22:00:00+01', '2026-11-19 21:59:00+01')
  THEN RAISE EXCEPTION 'scheduled feed freshness horizon is incorrect'; END IF;
END $$;
INSERT INTO private.brilstash_generations (
  installation_id, id, expected_active_generation_id, catalogue_revision,
  source_read_at, payload, payload_digest, source_manifest
)
SELECT installation_id, '70000000-0000-4000-8000-000000000002', id, catalogue_revision,
  source_read_at, payload, payload_digest, source_manifest
FROM private.brilstash_generations WHERE id = '70000000-0000-4000-8000-000000000001';
INSERT INTO private.brilstash_generations (
  installation_id, id, expected_active_generation_id, catalogue_revision,
  source_read_at, payload, payload_digest, source_manifest
)
SELECT installation_id, '70000000-0000-4000-8000-000000000091', expected_active_generation_id, catalogue_revision,
  source_read_at, payload, payload_digest, source_manifest
FROM private.brilstash_generations WHERE id = '70000000-0000-4000-8000-000000000002';
CREATE OR REPLACE FUNCTION private.brilstash_clock()
RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT COALESCE(
    NULLIF(current_setting('fixture.closure_clock', true), '')::timestamptz,
    ((statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date + time '22:15:00') AT TIME ZONE 'Africa/Lagos'
  )
$$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  installation uuid := '30000000-0000-4000-8000-000000000001';
  candidate uuid := '70000000-0000-4000-8000-000000000002';
  window_date date := (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date;
  revision bigint;
BEGIN
  BEGIN
    PERFORM public.close_brilstash_admission(installation, candidate, window_date);
    RAISE EXCEPTION 'closure started before the operator approved the candidate';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.approve_brilstash_candidate(installation, candidate, current_setting('fixture.candidate_digest'));
  PERFORM set_config('fixture.closure_clock', ((window_date + time '00:15') AT TIME ZONE 'Africa/Lagos')::text, true);
  BEGIN
    PERFORM public.close_brilstash_admission(installation, candidate, window_date - 1);
    RAISE EXCEPTION 'after-midnight retry closed admission under the previous date';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM set_config('fixture.closure_clock', ((window_date + time '23:07:51') AT TIME ZONE 'Africa/Lagos')::text, true);
  BEGIN
    PERFORM public.close_brilstash_admission(installation, candidate, window_date);
    RAISE EXCEPTION 'closure accepted one second past the latest safe time';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM set_config('fixture.closure_clock', ((window_date + time '23:07:50') AT TIME ZONE 'Africa/Lagos')::text, true);
    IF public.close_brilstash_admission(installation, candidate, window_date) IS NULL THEN
      RAISE EXCEPTION 'closure did not accept the last safe second';
    END IF;
    RAISE EXCEPTION 'rollback successful boundary test' USING ERRCODE = 'PT003';
  EXCEPTION WHEN SQLSTATE 'PT003' THEN NULL;
  END;
  PERFORM set_config('fixture.closure_clock', '', true);
  revision := public.close_brilstash_admission(installation, candidate, window_date);
  PERFORM set_config('fixture.closure_revision', revision::text, true);
  BEGIN
    PERFORM public.observe_brilstash_closure(installation, revision);
    RAISE EXCEPTION 'closure observation was accepted before commit';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.promote_brilstash_snapshot(installation, candidate, window_date, revision);
    RAISE EXCEPTION 'promoted without drain evidence';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.record_brilstash_drain_evidence(installation, revision, 'committed', 'premature');
    RAISE EXCEPTION 'accepted evidence before responses could finish';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'draining feed was still served'; END IF;
END $$;
RESET ROLE;
-- The other fixtures share one rollback transaction. Simulate a committed
-- closure only after asserting that the real same-transaction call was denied.
UPDATE private.brilstash_drains SET closure_xid = ((pg_current_xact_id()::text::bigint - 1)::text)::xid8
WHERE outcome IS NULL;
SET LOCAL ROLE authenticated;
DO $$
DECLARE installation uuid := '30000000-0000-4000-8000-000000000001';
DECLARE revision bigint := current_setting('fixture.closure_revision')::bigint;
BEGIN
  PERFORM public.observe_brilstash_closure(installation, revision);
  BEGIN
    PERFORM public.record_brilstash_drain_evidence(installation, revision, 'committed', 'No response time elapsed');
    RAISE EXCEPTION 'drain evidence was accepted before the post-commit wait elapsed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;
CREATE OR REPLACE FUNCTION private.brilstash_clock()
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE local_date date := (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date;
BEGIN
  IF current_setting('fixture.promotion_clock_step', true) = 'first' THEN
    PERFORM set_config('fixture.promotion_clock_step', 'second', true);
    RETURN (local_date + time '23:27:00') AT TIME ZONE 'Africa/Lagos';
  ELSIF current_setting('fixture.promotion_clock_step', true) = 'second' THEN
    RETURN (local_date + time '23:29:00') AT TIME ZONE 'Africa/Lagos';
  END IF;
  RETURN (local_date + time '22:40:00') AT TIME ZONE 'Africa/Lagos';
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  installation uuid := '30000000-0000-4000-8000-000000000001';
  revision bigint := current_setting('fixture.closure_revision')::bigint;
BEGIN
  BEGIN
    PERFORM public.record_brilstash_drain_evidence(installation, revision - 1, 'committed', 'stale evidence');
    RAISE EXCEPTION 'accepted an old closure revision';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.record_brilstash_drain_evidence(installation, revision, 'committed', 'recorded partner disposition');
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'recording evidence reopened the old generation'; END IF;
END $$;
RESET ROLE;
SAVEPOINT changed_promotion_display;
UPDATE public.products SET brand = 'Changed brand' WHERE slug = 'fixture-phone';
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.promote_brilstash_snapshot(
    '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002',
    (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date,
    current_setting('fixture.closure_revision')::bigint
  );
  RAISE EXCEPTION 'promotion accepted a display field changed after staging';
EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'BrilStash staged display data changed' THEN RAISE; END IF;
END $$;
ROLLBACK TO SAVEPOINT changed_promotion_display;
RELEASE SAVEPOINT changed_promotion_display;
SAVEPOINT changed_promotion_domain;
UPDATE public.domains SET merchant_id = '20000000-0000-4000-8000-000000000002'
WHERE domain = 'shop.example.invalid';
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.promote_brilstash_snapshot(
    '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002',
    (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date,
    current_setting('fixture.closure_revision')::bigint
  );
  RAISE EXCEPTION 'promotion accepted a storefront transferred to another merchant';
EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'BrilStash staged display data changed' THEN RAISE; END IF;
END $$;
ROLLBACK TO SAVEPOINT changed_promotion_domain;
RELEASE SAVEPOINT changed_promotion_domain;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  installation uuid := '30000000-0000-4000-8000-000000000001';
  candidate uuid := '70000000-0000-4000-8000-000000000002';
  revision bigint := current_setting('fixture.closure_revision')::bigint;
BEGIN
  BEGIN
    PERFORM public.promote_brilstash_snapshot(
      installation, '70000000-0000-4000-8000-000000000091',
      (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date, revision
    );
    RAISE EXCEPTION 'promotion accepted a different candidate than the one selected at closure';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM set_config('fixture.promotion_clock_step', 'first', true);
    PERFORM public.promote_brilstash_snapshot(
      installation, candidate, (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date, revision
    );
    RAISE EXCEPTION 'promotion consumed the remaining allowance during validation';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'BrilStash promotion window ended' THEN RAISE; END IF;
  END;
  IF public.promote_brilstash_snapshot(
    installation, candidate, (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date, revision
  ) IS DISTINCT FROM candidate THEN RAISE EXCEPTION 'promotion failed'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0)->>'generationId'
    IS DISTINCT FROM '70000000-0000-4000-8000-000000000002'
  THEN RAISE EXCEPTION 'promoted generation was not served'; END IF;
END $$;
RESET ROLE;

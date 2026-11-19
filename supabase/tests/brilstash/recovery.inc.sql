-- The approved replacement was built after suspension and points to the
-- suspended generation. The fixture uses an installation-wide partner pause.
INSERT INTO private.brilstash_generations (
  installation_id, id, expected_active_generation_id, catalogue_revision,
  source_read_at, payload, payload_digest, source_manifest
)
SELECT g.installation_id, '70000000-0000-4000-8000-000000000003', g.id,
  i.catalogue_revision, greatest(g.source_read_at, s.suspended_at), g.payload, g.payload_digest, g.source_manifest
FROM private.brilstash_generations g
JOIN private.brilstash_installations i ON i.id = g.installation_id AND i.active_generation_id = g.id
JOIN private.brilstash_suspensions s ON s.installation_id = i.id;
SELECT set_config('fixture.suspension_id', id::text, true) FROM private.brilstash_suspensions
WHERE installation_id = '30000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  installation uuid := '30000000-0000-4000-8000-000000000001';
  candidate uuid := '70000000-0000-4000-8000-000000000003';
  old_candidate uuid := '70000000-0000-4000-8000-000000000002';
  suspension_id uuid := current_setting('fixture.suspension_id')::uuid;
  window_date date := (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date;
  approval uuid;
BEGIN
  approval := public.approve_brilstash_candidate(installation, candidate, current_setting('fixture.candidate_digest'));
  BEGIN
    PERFORM public.resume_brilstash_installation(installation, suspension_id, candidate,
      approval, window_date, 'unverified outcome', true, false, ARRAY[]::text[]);
    RAISE EXCEPTION 'resume ignored pending partner jobs';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.resume_brilstash_installation(installation, suspension_id, old_candidate,
      approval, window_date, 'verified partner pause', true, true, ARRAY[]::text[]);
    RAISE EXCEPTION 'old generation was allowed to resume';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.resume_brilstash_installation(installation, suspension_id, candidate,
      approval, window_date, 'verified listing takedown', true, true, ARRAY['fixture-one']);
    RAISE EXCEPTION 'replacement relisted the withdrawn item';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF public.resume_brilstash_installation(installation, suspension_id, candidate, approval,
    window_date, 'verified installation pause and drain', true, true, ARRAY[]::text[])
    IS DISTINCT FROM candidate THEN RAISE EXCEPTION 'resume did not return the approved generation'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0)->>'generationId'
    IS DISTINCT FROM '70000000-0000-4000-8000-000000000003'
  THEN RAISE EXCEPTION 'recovery did not serve the approved replacement'; END IF;
END $$;
RESET ROLE;

INSERT INTO private.brilstash_generations (
  installation_id, id, expected_active_generation_id, catalogue_revision,
  source_read_at, payload, payload_digest, source_manifest
)
SELECT installation_id, '70000000-0000-4000-8000-000000000004', id,
  catalogue_revision, source_read_at, payload, payload_digest, source_manifest
FROM private.brilstash_generations WHERE id = '70000000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  installation uuid := '30000000-0000-4000-8000-000000000001';
  candidate uuid := '70000000-0000-4000-8000-000000000004';
  window_date date := (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date;
  revision bigint;
  next_revision bigint;
BEGIN
  PERFORM public.approve_brilstash_candidate(installation, candidate, current_setting('fixture.candidate_digest'));
  revision := public.close_brilstash_admission(installation, candidate, window_date);
  PERFORM public.abort_brilstash_drain(installation, revision);
  next_revision := public.close_brilstash_admission(installation, candidate, window_date);
  PERFORM set_config('fixture.recovery_closure_revision', next_revision::text, true);
  IF next_revision <= revision THEN RAISE EXCEPTION 'abort reused closure revision'; END IF;
  BEGIN
    PERFORM public.record_brilstash_drain_evidence(installation, revision, 'committed', 'old closure');
    RAISE EXCEPTION 'aborted closure evidence authorized the next drain';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;

SELECT set_config('fixture.recovery_protected_until', protected_until::text, true)
FROM private.brilstash_drain_policies
WHERE installation_id = '30000000-0000-4000-8000-000000000001';
UPDATE private.brilstash_drain_policies p
SET protected_until = g.source_read_at + interval '26 hours'
FROM private.brilstash_installations i
JOIN private.brilstash_generations g ON g.installation_id = i.id AND g.id = i.active_generation_id
WHERE p.installation_id = i.id AND i.id = '30000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.abort_brilstash_drain(
    '30000000-0000-4000-8000-000000000001', current_setting('fixture.recovery_closure_revision')::bigint
  );
  RAISE EXCEPTION 'abort reopened admission even though the generation cannot cover the protected window';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.brilstash_installations i
    JOIN private.brilstash_drains d ON d.installation_id = i.id AND d.closure_revision = i.serving_revision
    WHERE i.id = '30000000-0000-4000-8000-000000000001' AND i.admission = 'closed' AND d.outcome IS NULL
      AND i.serving_revision = current_setting('fixture.recovery_closure_revision')::bigint
  ) THEN RAISE EXCEPTION 'a rejected abort changed the installation or drain'; END IF;
END $$;
UPDATE private.brilstash_drain_policies
SET protected_until = NULLIF(current_setting('fixture.recovery_protected_until'), '')::timestamptz
WHERE installation_id = '30000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('fixture.targeted_suspension_id', public.suspend_brilstash_listings(
  '30000000-0000-4000-8000-000000000001', 'Fixture listing takedown', ARRAY['fixture-one']
)::text, true);
RESET ROLE;
INSERT INTO private.brilstash_generations (
  installation_id, id, expected_active_generation_id, catalogue_revision,
  source_read_at, payload, payload_digest, source_manifest
)
SELECT g.installation_id, '70000000-0000-4000-8000-000000000005', g.id,
  i.catalogue_revision, greatest(g.source_read_at, s.suspended_at),
  g.payload, g.payload_digest, g.source_manifest
FROM private.brilstash_generations g
JOIN private.brilstash_installations i ON i.id = g.installation_id AND i.active_generation_id = g.id
JOIN private.brilstash_suspensions s ON s.installation_id = i.id
  AND s.id = current_setting('fixture.targeted_suspension_id')::uuid;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  installation uuid := '30000000-0000-4000-8000-000000000001';
  candidate uuid := '70000000-0000-4000-8000-000000000005';
  approval uuid;
BEGIN
  approval := public.approve_brilstash_candidate(installation, candidate, current_setting('fixture.candidate_digest'));
  BEGIN
    PERFORM public.resume_brilstash_installation(installation,
      current_setting('fixture.targeted_suspension_id')::uuid, candidate, approval,
      (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date,
      'Fixture proof with omitted IDs', true, true, ARRAY[]::text[]);
    RAISE EXCEPTION 'resume dropped a recorded withdrawal target';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;

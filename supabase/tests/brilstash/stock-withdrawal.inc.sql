SAVEPOINT stock_withdrawal;
UPDATE public.products SET manage_stock = false WHERE slug = 'fixture-phone';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'old generation still served an untracked listing'; END IF;
END $$;
RESET ROLE;
SELECT set_config('fixture.withdrawal_catalogue', catalogue_revision::text, true)
FROM private.brilstash_installations WHERE id = '30000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000002';
DO $$
DECLARE installation uuid := '30000000-0000-4000-8000-000000000001';
DECLARE revision bigint := current_setting('fixture.withdrawal_catalogue')::bigint;
DECLARE approval uuid;
BEGIN
  approval := public.approve_brilstash_stock_withdrawal(installation, revision, 'fixture-one', 'Public untracked source reviewed');
  IF approval IS NULL THEN RAISE EXCEPTION 'zero-stock withdrawal was not approved'; END IF;
  PERFORM set_config('fixture.withdrawal_approval', approval::text, true);
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'approval alone revived the old generation'; END IF;
END $$;
RESET ROLE;
SELECT set_config('fixture.withdrawal_payload', payload::text, true),
  set_config('fixture.withdrawal_digest', payload_digest, true)
FROM private.brilstash_generations WHERE id = '70000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000001';
DO $$
DECLARE installation uuid := '30000000-0000-4000-8000-000000000001';
DECLARE candidate uuid := '70000000-0000-4000-8000-000000000090';
DECLARE read_result jsonb := public.load_brilstash_catalogue_sources(installation);
DECLARE source_time timestamptz := LEAST((read_result->>'sourceReadAt')::timestamptz,
  ((statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date + time '22:00') AT TIME ZONE 'Africa/Lagos');
BEGIN
  IF read_result->'retiredExternalIds' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'the source response included retired history outside the active snapshot';
  END IF;
  IF read_result->'rows'->0->'inventory'->>'kind' IS DISTINCT FROM 'withdrawn'
    OR read_result->'rows'->0->'inventory'->>'approvalId' IS DISTINCT FROM current_setting('fixture.withdrawal_approval')
  THEN RAISE EXCEPTION 'builder did not read the exact withdrawal approval'; END IF;
  IF public.stage_brilstash_catalogue_snapshot(
    installation, candidate, (read_result->>'catalogueRevision')::bigint,
    (read_result->>'expectedActiveGenerationId')::uuid, source_time,
    read_result->'rows', current_setting('fixture.withdrawal_payload')::jsonb, current_setting('fixture.withdrawal_digest')
  ) IS DISTINCT FROM candidate THEN RAISE EXCEPTION 'reviewed withdrawal could not be staged'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000002';
SELECT public.configure_brilstash_drain_policy(
  '30000000-0000-4000-8000-000000000001', 1200, 120, NULL, 'Fixture drain boundaries'
);
SELECT public.approve_brilstash_candidate(
  '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000090',
  current_setting('fixture.withdrawal_digest')
);
SELECT set_config('fixture.withdrawal_closure', public.close_brilstash_admission(
  '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000090',
  (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date
)::text, true);
RESET ROLE;
UPDATE private.brilstash_drains SET closure_xid = ((pg_current_xact_id()::text::bigint - 1)::text)::xid8
WHERE outcome IS NULL;
SET LOCAL ROLE authenticated;
SELECT public.observe_brilstash_closure(
  '30000000-0000-4000-8000-000000000001', current_setting('fixture.withdrawal_closure')::bigint
);
RESET ROLE;
CREATE OR REPLACE FUNCTION private.brilstash_clock()
RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT ((statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date + time '22:40:00') AT TIME ZONE 'Africa/Lagos'
$$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE installation uuid := '30000000-0000-4000-8000-000000000001';
DECLARE candidate uuid := '70000000-0000-4000-8000-000000000090';
DECLARE closure bigint := current_setting('fixture.withdrawal_closure')::bigint;
BEGIN
  PERFORM public.record_brilstash_drain_evidence(installation, closure, 'committed', 'Fixture prior job settled');
  IF public.promote_brilstash_snapshot(
    installation, candidate, (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date, closure
  ) IS DISTINCT FROM candidate THEN RAISE EXCEPTION 'reviewed withdrawal did not promote'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
DECLARE result jsonb := fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0);
BEGIN
  IF result->>'status' IS DISTINCT FROM 'ok'
    OR result->'products'->0->>'external_id' IS DISTINCT FROM 'fixture-one'
    OR result->'products'->0->>'stock_quantity' IS DISTINCT FROM '0'
  THEN RAISE EXCEPTION 'reviewed withdrawal was not served for the same identity'; END IF;
END $$;
RESET ROLE;
UPDATE public.products SET status = 'draft' WHERE slug = 'fixture-phone';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'stock withdrawal approval exposed a private source'; END IF;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT stock_withdrawal;
RELEASE SAVEPOINT stock_withdrawal;

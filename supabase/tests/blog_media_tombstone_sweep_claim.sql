-- ================================================================
-- REGRESSION TEST: atomic tombstone sweep claim and save-path probe
--
-- USAGE:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/blog_media_tombstone_sweep_claim.sql
-- ================================================================

BEGIN;

-- Merchant writes fire the canonical audit trigger, which rejects actorless
-- callers (28000), so the fixtures run under the service actor like the
-- other SQL checks that seed merchants.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
VALUES
  ('media', 'platform/blog/stale.webp', NULL, NULL, '{}'::jsonb),
  ('media', 'platform/blog/kept.webp', NULL, NULL, '{}'::jsonb),
  ('media', 'platform/blog/fresh.webp', NULL, NULL, '{}'::jsonb),
  ('media', 'platform/blog/special_%_name.webp', NULL, NULL, '{}'::jsonb),
  ('media', 'platform/blog/merchant.webp', NULL, NULL, '{}'::jsonb);

INSERT INTO public.blog_media_delete_tombstones (path, created_at)
VALUES
  ('platform/blog/stale.webp', now() - interval '2 hours'),
  ('platform/blog/kept.webp', now() - interval '2 hours'),
  ('platform/blog/fresh.webp', now() - interval '10 minutes'),
  ('platform/blog/special_%_name.webp', now() - interval '2 hours'),
  ('platform/blog/merchant.webp', now() - interval '2 hours');

INSERT INTO public.blog_posts (
  title, slug, content, author_name, is_platform_post, merchant_id,
  featured_image_variants
)
VALUES (
  'Sweep claim test',
  'sweep-claim-test-post',
  '<img src="https://cdn.example.com/media/platform/blog/kept.webp">',
  'Editorial',
  true,
  NULL,
  '{"landscape_16x9": "https://cdn.example.com/media/platform/blog/kept.webp"}'::jsonb
);

INSERT INTO public.merchants (id, email)
VALUES (
  '6f9d0e12-0000-4000-8000-00000000c001',
  'sweep-claim-merchant@example.test'
);

INSERT INTO public.blog_posts (
  title, slug, content, author_name, is_platform_post, merchant_id
)
VALUES (
  'Merchant story',
  'sweep-claim-merchant-post',
  '<img src="https://cdn.example.com/media/platform/blog/merchant.webp">',
  'Merchant',
  false,
  '6f9d0e12-0000-4000-8000-00000000c001'
);

DO $claim$
DECLARE
  v_row RECORD;
  v_claimed_count integer := 0;
  v_total_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT tombstone_path, tombstone_claimed
      FROM public.claim_sweepable_blog_media_tombstones(
        now() - interval '1 hour',
        500
      )
  LOOP
    v_total_count := v_total_count + 1;
    IF v_row.tombstone_path IN (
      'platform/blog/stale.webp',
      'platform/blog/special_%_name.webp'
    ) AND v_row.tombstone_claimed IS TRUE
    THEN
      v_claimed_count := v_claimed_count + 1;
    ELSIF v_row.tombstone_path IN (
      'platform/blog/kept.webp',
      'platform/blog/merchant.webp'
    ) AND v_row.tombstone_claimed IS FALSE
    THEN
      CONTINUE;
    ELSE
      RAISE EXCEPTION
        'unexpected claim row: % claimed=%',
        v_row.tombstone_path,
        v_row.tombstone_claimed;
    END IF;
  END LOOP;

  IF v_total_count <> 4 THEN
    RAISE EXCEPTION 'claim must return exactly the 4 due rows, got %', v_total_count;
  END IF;
  IF v_claimed_count <> 2 THEN
    RAISE EXCEPTION 'claim must claim exactly stale + special, got %', v_claimed_count;
  END IF;

  IF (
    SELECT count(*)
      FROM public.blog_media_delete_tombstones
     WHERE path IN ('platform/blog/stale.webp', 'platform/blog/special_%_name.webp')
       AND claimed IS TRUE
  ) <> 2 THEN
    RAISE EXCEPTION 'claim must flag exactly stale + special as claimed';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.blog_media_delete_tombstones
     WHERE path IN ('platform/blog/kept.webp', 'platform/blog/merchant.webp')
  ) THEN
    RAISE EXCEPTION 'claim must resurrect platform and merchant references';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.blog_media_delete_tombstones
     WHERE path = 'platform/blog/fresh.webp'
       AND claimed IS FALSE
  ) THEN
    RAISE EXCEPTION 'claim must leave the fresh row untouched and unclaimed';
  END IF;

  IF (
    SELECT count(*)
      FROM storage.objects
     WHERE bucket_id = 'media'
       AND name LIKE 'platform/blog/%'
  ) <> 5 THEN
    RAISE EXCEPTION 'claim must not touch object metadata; the Storage API removes it';
  END IF;
END;
$claim$;

DO $probe$
DECLARE
  v_present_count integer;
BEGIN
  SELECT count(*)
    INTO v_present_count
    FROM public.blog_media_objects_present_v1(
      ARRAY[
        'platform/blog/stale.webp',
        'platform/blog/kept.webp',
        'platform/blog/fresh.webp',
        'platform/blog/missing.webp'
      ]
    );
  IF v_present_count <> 3 THEN
    RAISE EXCEPTION 'presence probe must report stale + kept + fresh, got %', v_present_count;
  END IF;

  SELECT count(*)
    INTO v_present_count
    FROM public.blog_media_objects_present_v1(ARRAY[]::text[]);
  IF v_present_count <> 0 THEN
    RAISE EXCEPTION 'presence probe must report nothing for an empty input';
  END IF;

  SELECT count(*)
    INTO v_present_count
    FROM public.claim_sweepable_blog_media_tombstones(
      now() - interval '1 hour',
      500
    )
   WHERE tombstone_claimed IS TRUE;
  IF v_present_count <> 2 THEN
    RAISE EXCEPTION
      'second claim must re-return the 2 still-claimed rows for retry, got %',
      v_present_count;
  END IF;
END;
$probe$;

DO $register$
DECLARE
  v_row RECORD;
  v_seen integer := 0;
BEGIN
  -- A merchant save commits after the sweep staged (but before it
  -- claimed) the tombstones for paths it now references.
  INSERT INTO public.blog_media_delete_tombstones (path, created_at)
  VALUES ('platform/blog/kept.webp', now() - interval '2 hours');

  FOR v_row IN
    SELECT path, status
      FROM public.register_blog_media_references_v1(
        ARRAY[
          'platform/blog/kept.webp',
          'platform/blog/stale.webp',
          'platform/blog/fresh.webp',
          'platform/blog/missing.webp'
        ]
      )
  LOOP
    v_seen := v_seen + 1;
    IF v_row.path = 'platform/blog/stale.webp'
      AND v_row.status = 'claimed'
    THEN
      CONTINUE;
    ELSIF v_row.path = 'platform/blog/missing.webp'
      AND v_row.status = 'missing'
    THEN
      CONTINUE;
    ELSIF v_row.path IN ('platform/blog/kept.webp', 'platform/blog/fresh.webp')
      AND v_row.status = 'cleared'
    THEN
      CONTINUE;
    ELSE
      RAISE EXCEPTION
        'unexpected register row: % status=%',
        v_row.path,
        v_row.status;
    END IF;
  END LOOP;

  IF v_seen <> 4 THEN
    RAISE EXCEPTION 'register must report all 4 candidates, got %', v_seen;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.blog_media_delete_tombstones
     WHERE path IN ('platform/blog/kept.webp', 'platform/blog/fresh.webp')
  ) THEN
    RAISE EXCEPTION 'register must resurrect unclaimed tombstones';
  END IF;

  IF (
    SELECT count(*)
      FROM public.blog_media_delete_tombstones
     WHERE path IN (
       'platform/blog/stale.webp',
       'platform/blog/special_%_name.webp'
     )
       AND claimed IS TRUE
  ) <> 2 THEN
    RAISE EXCEPTION 'register must leave claimed rows flagged';
  END IF;

  IF (
    SELECT count(*)
      FROM storage.objects
     WHERE bucket_id = 'media'
       AND name LIKE 'platform/blog/%'
  ) <> 5 THEN
    RAISE EXCEPTION 'register must not touch object metadata';
  END IF;
END;
$register$;

DO $encoded$
DECLARE
  v_claimed boolean;
BEGIN
  -- Extraction decodes %74 to t while the persisted text stays
  -- encoded: the claim must resurrect the decoded candidate instead
  -- of flagging the live object. The malformed bare % proves the
  -- decoder falls back instead of raising.
  INSERT INTO public.blog_posts (
    id, title, slug, author_name, is_platform_post, merchant_id, content
  )
  VALUES ('01ac0000-0000-4000-8000-000000000099', 'Encoded', 'encoded', 'QA',
    TRUE, NULL,
    '<p>100% real</p><img src="https://cdn.example.com/media/platform/blog/%74oken.webp">');
  INSERT INTO public.blog_media_delete_tombstones (path, created_at)
  VALUES ('platform/blog/token.webp', now() - interval '2 hours');
  SELECT claim.tombstone_claimed INTO v_claimed
    FROM public.claim_sweepable_blog_media_tombstones(
      now() - interval '1 hour', 500) AS claim
   WHERE claim.tombstone_path = 'platform/blog/token.webp';
  IF v_claimed IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'encoded reference must resurrect, got %', v_claimed;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.blog_media_delete_tombstones
     WHERE path = 'platform/blog/token.webp'
  ) THEN
    RAISE EXCEPTION 'resurrected encoded tombstone must be deleted';
  END IF;
  DELETE FROM public.blog_posts
   WHERE id = '01ac0000-0000-4000-8000-000000000099';
END;
$encoded$;

DO $scope$
DECLARE
  v_released integer;
BEGIN
  -- Out-of-scope staging fails even for RLS-bypassing roles: the
  -- CHECK bounds the table itself, not just the PostgREST policies.
  BEGIN
    INSERT INTO public.blog_media_delete_tombstones (path)
    VALUES ('merchant/evil.webp');
    RAISE EXCEPTION 'out-of-scope tombstone insert unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Non-service inserts land server-owned: an already-due claimed
  -- row cannot be staged through PostgREST.
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES ('platform/blog/scope-forced.webp', now() - interval '2 hours', TRUE);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  IF NOT EXISTS (
    SELECT 1
      FROM public.blog_media_delete_tombstones
     WHERE path = 'platform/blog/scope-forced.webp'
       AND claimed IS FALSE
       AND created_at > now() - interval '1 minute'
  ) THEN
    RAISE EXCEPTION 'tombstone insert state was not forced server-side';
  END IF;
  DELETE FROM public.blog_media_delete_tombstones
   WHERE path = 'platform/blog/scope-forced.webp';

  -- The worker wrappers refuse any role but the worker, even when the
  -- session role holds EXECUTE with a mismatched JWT claim.
  SET LOCAL ROLE blog_media_sweep_worker;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    PERFORM public.blog_media_sweep_worker_claim(now(), 1);
    RAISE EXCEPTION 'worker claim unexpectedly accepted a non-worker role';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- The release wrapper rejects out-of-scope paths before deleting.
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role', 'blog_media_sweep_worker', true);
  BEGIN
    PERFORM public.blog_media_sweep_worker_release(ARRAY['merchant/evil.webp']);
    RAISE EXCEPTION 'worker release unexpectedly accepted an out-of-scope path';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  -- Release drops only claimed rows: stale is still flagged from the
  -- claim block, while an unclaimed path releases nothing.
  SELECT public.blog_media_sweep_worker_release(
    ARRAY['platform/blog/stale.webp']) INTO v_released;
  IF v_released <> 1 THEN
    RAISE EXCEPTION 'worker release must drop the claimed row, got %', v_released;
  END IF;
  SELECT public.blog_media_sweep_worker_release(
    ARRAY['platform/blog/never-staged.webp']) INTO v_released;
  IF v_released <> 0 THEN
    RAISE EXCEPTION 'worker release must ignore unclaimed paths, got %', v_released;
  END IF;

  -- The Storage API's deletes run as the worker role: privileges let
  -- the statement reach RLS, and the policy admits only the platform
  -- prefix. Without the table grant the delete fails before the
  -- policy; without the policy the merchant row would fall too.
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES
    ('media', 'platform/blog/scope-worker-del.webp', NULL, NULL, '{}'::jsonb),
    ('media', 'platform/blog/scope-worker-staged.webp', NULL, NULL, '{}'::jsonb),
    ('media', 'merchant/scope-worker-kept.webp', NULL, NULL, '{}'::jsonb);
  -- The deletable row carries a claimed tombstone like a swept byte;
  -- the staged row is a fresh upload awaiting save.
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES
    ('platform/blog/scope-worker-del.webp', now() - interval '2 hours', TRUE),
    ('platform/blog/scope-worker-staged.webp', now(), FALSE);
  SET LOCAL ROLE blog_media_sweep_worker;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role', 'blog_media_sweep_worker', true);
  -- The Storage API sets storage.allow_delete_query for its own
  -- deletes; direct SQL must opt in the same way to exercise the
  -- RLS path instead of tripping the protection trigger.
  PERFORM pg_catalog.set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.objects
   WHERE bucket_id = 'media'
     AND name IN (
      'platform/blog/scope-worker-del.webp',
      'platform/blog/scope-worker-staged.webp',
      'merchant/scope-worker-kept.webp'
    );

  -- The worker holds no SELECT, so the outcome is asserted back as
  -- the fixture role.
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  IF EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'media'
       AND name = 'platform/blog/scope-worker-del.webp'
  ) THEN
    RAISE EXCEPTION 'worker role must delete claimed platform bytes';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'media'
       AND name = 'platform/blog/scope-worker-staged.webp'
  ) THEN
    RAISE EXCEPTION 'worker role must not delete unclaimed staged bytes';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'media'
       AND name = 'merchant/scope-worker-kept.webp'
  ) THEN
    RAISE EXCEPTION 'worker role must not delete out-of-scope bytes';
  END IF;
  DELETE FROM storage.objects
   WHERE bucket_id = 'media'
     AND name IN (
      'platform/blog/scope-worker-staged.webp',
      'merchant/scope-worker-kept.webp'
    );
  DELETE FROM public.blog_media_delete_tombstones
   WHERE path IN (
    'platform/blog/scope-worker-del.webp',
    'platform/blog/scope-worker-staged.webp'
  );
END;
$scope$;

DO $grants$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid =
        'public.blog_media_sweep_worker_claim(timestamptz,integer)'::pg_catalog.regprocedure
       AND proc.prosecdef
       AND proc.provolatile = 'v'
       AND proc.proowner = 'postgres'::pg_catalog.regrole
  ) THEN
    RAISE EXCEPTION 'worker claim wrapper must be VOLATILE SECURITY DEFINER owned by postgres';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid =
        'public.blog_media_sweep_worker_release(text[])'::pg_catalog.regprocedure
       AND proc.prosecdef
       AND proc.provolatile = 'v'
       AND proc.proowner = 'postgres'::pg_catalog.regrole
  ) THEN
    RAISE EXCEPTION 'worker release wrapper must be VOLATILE SECURITY DEFINER owned by postgres';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'blog_media_sweep_worker',
    'public.blog_media_sweep_worker_claim(timestamptz,integer)',
    'execute'
  ) OR NOT pg_catalog.has_function_privilege(
    'blog_media_sweep_worker',
    'public.blog_media_sweep_worker_release(text[])',
    'execute'
  ) THEN
    RAISE EXCEPTION 'sweep worker must execute only its two wrappers';
  END IF;

  IF pg_catalog.has_function_privilege(
    'blog_media_sweep_worker',
    'public.claim_sweepable_blog_media_tombstones(timestamptz,integer)',
    'execute'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.blog_media_sweep_worker_claim(timestamptz,integer)',
    'execute'
  ) OR pg_catalog.has_function_privilege(
    'service_role',
    'public.blog_media_sweep_worker_release(text[])',
    'execute'
  ) THEN
    RAISE EXCEPTION 'sweep worker capability leaks beyond its wrappers';
  END IF;

  IF NOT pg_catalog.has_schema_privilege(
    'blog_media_sweep_worker', 'storage', 'USAGE'
  ) OR NOT pg_catalog.has_table_privilege(
    'blog_media_sweep_worker', 'storage.objects', 'DELETE'
  ) OR NOT pg_catalog.has_table_privilege(
    'blog_media_sweep_worker', 'storage.objects', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'sweep worker lacks the storage deletion grant';
  END IF;

  IF pg_catalog.has_table_privilege(
    'blog_media_sweep_worker', 'storage.objects', 'INSERT'
  ) OR pg_catalog.has_table_privilege(
    'blog_media_sweep_worker', 'storage.objects', 'UPDATE'
  ) OR pg_catalog.has_table_privilege(
    'blog_media_sweep_worker', 'storage.objects', 'TRUNCATE'
  ) THEN
    RAISE EXCEPTION 'sweep worker holds more than SELECT, DELETE on storage.objects';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
    'blog_media_sweep_worker', 'public.merchants', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'sweep worker lacks the policy-evaluation grant';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid =
        'public.blog_media_sweep_worker_can_delete(text)'::pg_catalog.regprocedure
       AND proc.prosecdef
       AND proc.provolatile = 's'
       AND proc.proowner = 'postgres'::pg_catalog.regrole
  ) THEN
    RAISE EXCEPTION 'worker delete predicate must be STABLE SECURITY DEFINER owned by postgres';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'blog_media_sweep_worker',
    'public.blog_media_sweep_worker_can_delete(text)',
    'execute'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.blog_media_sweep_worker_can_delete(text)',
    'execute'
  ) OR pg_catalog.has_function_privilege(
    'service_role',
    'public.blog_media_sweep_worker_can_delete(text)',
    'execute'
  ) THEN
    RAISE EXCEPTION 'worker delete predicate leaks beyond the worker role';
  END IF;

  IF pg_catalog.has_table_privilege(
    'blog_media_sweep_worker', 'public.merchants', 'INSERT'
  ) OR pg_catalog.has_table_privilege(
    'blog_media_sweep_worker', 'public.merchants', 'UPDATE'
  ) OR pg_catalog.has_table_privilege(
    'blog_media_sweep_worker', 'public.merchants', 'DELETE'
  ) THEN
    RAISE EXCEPTION 'sweep worker holds writes on merchants';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid =
        'public.claim_sweepable_blog_media_tombstones(timestamptz,integer)'::pg_catalog.regprocedure
       AND proc.prosecdef
       AND proc.provolatile = 'v'
       AND proc.proowner = 'postgres'::pg_catalog.regrole
       AND EXISTS (
        SELECT 1
          FROM pg_catalog.pg_options_to_table(
            COALESCE(proc.proconfig, ARRAY[]::text[])
          ) AS config
         WHERE config.option_name = 'search_path'
           AND pg_catalog.btrim(config.option_value, '"') = ''
      )
  ) THEN
    RAISE EXCEPTION 'claim RPC must be VOLATILE SECURITY DEFINER with blank search_path';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid =
        'public.blog_media_objects_present_v1(text[])'::pg_catalog.regprocedure
       AND proc.prosecdef
       AND proc.provolatile = 's'
       AND proc.proowner = 'postgres'::pg_catalog.regrole
       AND EXISTS (
        SELECT 1
          FROM pg_catalog.pg_options_to_table(
            COALESCE(proc.proconfig, ARRAY[]::text[])
          ) AS config
         WHERE config.option_name = 'search_path'
           AND pg_catalog.btrim(config.option_value, '"') = ''
      )
  ) THEN
    RAISE EXCEPTION 'presence RPC must be STABLE SECURITY DEFINER with blank search_path';
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon',
    'public.claim_sweepable_blog_media_tombstones(timestamptz,integer)',
    'execute'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.claim_sweepable_blog_media_tombstones(timestamptz,integer)',
    'execute'
  ) THEN
    RAISE EXCEPTION 'claim RPC must not be executable by anon/authenticated';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.claim_sweepable_blog_media_tombstones(timestamptz,integer)',
    'execute'
  ) THEN
    RAISE EXCEPTION 'claim RPC must be executable by service_role';
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon',
    'public.blog_media_objects_present_v1(text[])',
    'execute'
  ) THEN
    RAISE EXCEPTION 'presence RPC must not be executable by anon';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.blog_media_objects_present_v1(text[])',
    'execute'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.blog_media_objects_present_v1(text[])',
    'execute'
  ) THEN
    RAISE EXCEPTION 'presence RPC must be executable by authenticated/service_role';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid =
        'public.register_blog_media_references_v1(text[])'::pg_catalog.regprocedure
       AND proc.prosecdef
       AND proc.provolatile = 'v'
       AND proc.proowner = 'postgres'::pg_catalog.regrole
       AND EXISTS (
        SELECT 1
          FROM pg_catalog.pg_options_to_table(
            COALESCE(proc.proconfig, ARRAY[]::text[])
          ) AS config
         WHERE config.option_name = 'search_path'
           AND pg_catalog.btrim(config.option_value, '"') = ''
      )
  ) THEN
    RAISE EXCEPTION 'register RPC must be VOLATILE SECURITY DEFINER with blank search_path';
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon',
    'public.register_blog_media_references_v1(text[])',
    'execute'
  ) THEN
    RAISE EXCEPTION 'register RPC must not be executable by anon';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.register_blog_media_references_v1(text[])',
    'execute'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.register_blog_media_references_v1(text[])',
    'execute'
  ) THEN
    RAISE EXCEPTION 'register RPC must be executable by authenticated/service_role';
  END IF;
END;
$grants$;

DO $refresh_update$
DECLARE
  v_member uuid := 'b1e62a11-0000-4000-8000-000000000001';
  v_other uuid := 'b1e62a11-0000-4000-8000-000000000002';
  v_updated integer;
BEGIN
  -- A delegated content manager (no legacy platform-admin merchant
  -- row) must refresh staged leases through PostgREST: without an
  -- UPDATE policy the heartbeat UPDATE matches zero rows silently
  -- and the sweep deletes media from an active draft. Fixtures seed
  -- as the session role (service_role holds no auth.users grant);
  -- the jwt claim still reads service_role, so the explicit
  -- created_at survives the force-insert trigger.
  RESET ROLE;
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_member, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'refresh-member@example.com', 'test', now(), now(), now(),
     '{}', '{}'),
    (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'refresh-other@example.com', 'test', now(), now(), now(),
     '{}', '{}');
  INSERT INTO public.platform_admin_memberships (user_id, role, status, reason)
  VALUES (v_member, 'content', 'active', 'refresh update regression test');
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES ('platform/blog/refresh-delegated.webp', now() - interval '50 minutes', FALSE);

  SET LOCAL ROLE authenticated;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_member::text, true);
  UPDATE public.blog_media_delete_tombstones
     SET created_at = now()
   WHERE path = 'platform/blog/refresh-delegated.webp'
     AND claimed IS FALSE;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'delegated content manager refresh updated % rows, want 1', v_updated;
  END IF;

  -- A user without the permission still refreshes nothing.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_other::text, true);
  UPDATE public.blog_media_delete_tombstones
     SET created_at = now()
   WHERE path = 'platform/blog/refresh-delegated.webp'
     AND claimed IS FALSE;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 0 THEN
    RAISE EXCEPTION 'unpermissioned refresh updated % rows, want 0', v_updated;
  END IF;

  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  IF NOT EXISTS (
    SELECT 1
      FROM public.blog_media_delete_tombstones
     WHERE path = 'platform/blog/refresh-delegated.webp'
       AND claimed IS FALSE
       AND created_at > now() - interval '1 minute'
  ) THEN
    RAISE EXCEPTION 'delegated refresh did not move the lease forward';
  END IF;

  -- Cleanup runs as the session role for the same grant reason.
  RESET ROLE;
  DELETE FROM public.blog_media_delete_tombstones
   WHERE path = 'platform/blog/refresh-delegated.webp';
  DELETE FROM public.platform_admin_memberships WHERE user_id = v_member;
  DELETE FROM auth.users WHERE id IN (v_member, v_other);
END;
$refresh_update$;

DO $cutoff_cap$
DECLARE
  v_claimed boolean;
BEGIN
  -- A future cutoff passed to the worker wrapper must not claim
  -- fresh uploads: the wrapper caps it at the standard grace
  -- window instead of trusting the argument.
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES
    ('platform/blog/cutoff-fresh.webp', now() - interval '10 minutes', FALSE),
    ('platform/blog/cutoff-due.webp', now() - interval '2 hours', FALSE);

  SET LOCAL ROLE blog_media_sweep_worker;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role', 'blog_media_sweep_worker', true);
  PERFORM public.blog_media_sweep_worker_claim(
    '2100-01-01T00:00:00Z'::timestamptz, 500);

  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  SELECT claimed INTO v_claimed
    FROM public.blog_media_delete_tombstones
   WHERE path = 'platform/blog/cutoff-fresh.webp';
  IF v_claimed IS NOT FALSE THEN
    RAISE EXCEPTION 'future cutoff claimed a fresh upload';
  END IF;

  -- The cap degrades to the standard window: genuinely due rows
  -- still claim through the same future-cutoff call.
  SELECT claimed INTO v_claimed
    FROM public.blog_media_delete_tombstones
   WHERE path = 'platform/blog/cutoff-due.webp';
  IF v_claimed IS NOT TRUE THEN
    RAISE EXCEPTION 'capped cutoff failed to claim a due row';
  END IF;

  DELETE FROM public.blog_media_delete_tombstones
   WHERE path IN (
    'platform/blog/cutoff-fresh.webp',
    'platform/blog/cutoff-due.webp'
  );
END;
$cutoff_cap$;

DO $mixed_decode$
DECLARE
  v_decoded TEXT;
  v_row RECORD;
  v_saw_token BOOLEAN := FALSE;
  v_saw_orphan BOOLEAN := FALSE;
BEGIN
  -- A stored field mixing a valid encoded reference with unrelated
  -- invalid bytes must still protect the live object: the invalid
  -- run cannot sink the whole-field decode anymore. The sub claim
  -- resets first: the audit trigger rejects actorful writers without
  -- content.manage, and the earlier delegated block leaves one set.
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);

  SELECT public.blog_media_percent_decode(
    'https://cdn.example.com/media/platform/blog/%74oken.webp and %FF text'
  ) INTO v_decoded;
  IF v_decoded <>
    'https://cdn.example.com/media/platform/blog/token.webp and %FF text'
  THEN
    RAISE EXCEPTION 'mixed decode lost the valid reference: %', v_decoded;
  END IF;

  -- Clean multi-byte escapes still fully decode on the first attempt.
  SELECT public.blog_media_percent_decode('platform/blog/caf%C3%A9.webp')
    INTO v_decoded;
  IF v_decoded <> 'platform/blog/café.webp' THEN
    RAISE EXCEPTION 'clean multi-byte decode regressed: %', v_decoded;
  END IF;

  INSERT INTO public.blog_posts (
    title, slug, content, author_name, is_platform_post, merchant_id
  )
  VALUES (
    'Mixed decode test',
    'sweep-claim-mixed-decode-post',
    '<p>100%FF coverage</p><img src="https://cdn.example.com/media/platform/blog/mixed-%74oken.webp">',
    'Editorial',
    TRUE,
    NULL
  );
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES
    ('platform/blog/mixed-token.webp', now() - interval '2 hours', FALSE),
    ('platform/blog/mixed-orphan.webp', now() - interval '2 hours', FALSE);

  FOR v_row IN
    SELECT tombstone_path, tombstone_claimed
      FROM public.claim_sweepable_blog_media_tombstones(
        now() - interval '1 hour',
        500
      )
  LOOP
    IF v_row.tombstone_path = 'platform/blog/mixed-token.webp' THEN
      v_saw_token := TRUE;
      IF v_row.tombstone_claimed IS TRUE THEN
        RAISE EXCEPTION 'mixed field failed to protect its live object';
      END IF;
    ELSIF v_row.tombstone_path = 'platform/blog/mixed-orphan.webp' THEN
      v_saw_orphan := TRUE;
      IF v_row.tombstone_claimed IS NOT TRUE THEN
        RAISE EXCEPTION 'claim skipped the mixed control orphan';
      END IF;
    END IF;
  END LOOP;
  IF NOT v_saw_token OR NOT v_saw_orphan THEN
    RAISE EXCEPTION 'claim omitted the mixed fixtures';
  END IF;

  -- Referenced rows resurrect (delete) rather than linger claimed.
  IF EXISTS (
    SELECT 1 FROM public.blog_media_delete_tombstones
     WHERE path = 'platform/blog/mixed-token.webp'
  ) THEN
    RAISE EXCEPTION 'mixed live object was not resurrected';
  END IF;

  DELETE FROM public.blog_posts WHERE slug = 'sweep-claim-mixed-decode-post';
  DELETE FROM public.blog_media_delete_tombstones
   WHERE path IN (
    'platform/blog/mixed-token.webp',
    'platform/blog/mixed-orphan.webp'
  );
END;
$mixed_decode$;

DO $json_slashes$
DECLARE
  v_decoded TEXT;
  v_row RECORD;
  v_saw_token BOOLEAN := FALSE;
  v_saw_unicode BOOLEAN := FALSE;
  v_saw_orphan BOOLEAN := FALSE;
BEGIN
  -- Structured editor content escapes slashes (`\/`, `\u002f`); the
  -- storefront parses and renders through them, so the scan must
  -- match the literal candidate path through them too, or the sweep
  -- deletes a live image.
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);

  SELECT public.blog_media_json_unescape_slashes(
    'https:\/\/cdn.example.com\/media\/platform\/blog\/token.webp'
  ) INTO v_decoded;
  IF v_decoded <>
    'https://cdn.example.com/media/platform/blog/token.webp'
  THEN
    RAISE EXCEPTION 'slash unescape failed: %', v_decoded;
  END IF;
  SELECT public.blog_media_json_unescape_slashes(
    'https:\u002f\u002fcdn.example.com\/media\/platform\/blog\/token.webp'
  ) INTO v_decoded;
  IF v_decoded <>
    'https://cdn.example.com/media/platform/blog/token.webp'
  THEN
    RAISE EXCEPTION 'unicode slash unescape failed: %', v_decoded;
  END IF;

  INSERT INTO public.blog_posts (
    title, slug, content, author_name, is_platform_post, merchant_id
  )
  VALUES (
    'JSON slash test',
    'sweep-claim-json-slash-post',
    '{"src":"https:\/\/cdn.example.com\/media\/platform\/blog\/json-token.webp"}',
    'Editorial',
    TRUE,
    NULL
  ), (
    'JSON unicode slash test',
    'sweep-claim-json-unicode-post',
    '{"src":"https:\u002f\u002fcdn.example.com\/media\/platform\/blog\/json-unicode.webp"}',
    'Editorial',
    TRUE,
    NULL
  );
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES
    ('platform/blog/json-token.webp', now() - interval '2 hours', FALSE),
    ('platform/blog/json-unicode.webp', now() - interval '2 hours', FALSE),
    ('platform/blog/json-orphan.webp', now() - interval '2 hours', FALSE);

  FOR v_row IN
    SELECT tombstone_path, tombstone_claimed
      FROM public.claim_sweepable_blog_media_tombstones(
        now() - interval '1 hour',
        500
      )
  LOOP
    IF v_row.tombstone_path = 'platform/blog/json-token.webp' THEN
      v_saw_token := TRUE;
      IF v_row.tombstone_claimed IS TRUE THEN
        RAISE EXCEPTION 'escaped slashes failed to protect a live object';
      END IF;
    ELSIF v_row.tombstone_path = 'platform/blog/json-unicode.webp' THEN
      v_saw_unicode := TRUE;
      IF v_row.tombstone_claimed IS TRUE THEN
        RAISE EXCEPTION 'unicode escapes failed to protect a live object';
      END IF;
    ELSIF v_row.tombstone_path = 'platform/blog/json-orphan.webp' THEN
      v_saw_orphan := TRUE;
      IF v_row.tombstone_claimed IS NOT TRUE THEN
        RAISE EXCEPTION 'claim skipped the JSON control orphan';
      END IF;
    END IF;
  END LOOP;
  IF NOT v_saw_token OR NOT v_saw_unicode OR NOT v_saw_orphan THEN
    RAISE EXCEPTION 'claim omitted the JSON fixtures';
  END IF;

  DELETE FROM public.blog_posts
   WHERE slug IN (
    'sweep-claim-json-slash-post',
    'sweep-claim-json-unicode-post'
  );
  DELETE FROM public.blog_media_delete_tombstones
   WHERE path IN (
    'platform/blog/json-token.webp',
    'platform/blog/json-unicode.webp',
    'platform/blog/json-orphan.webp'
  );
END;
$json_slashes$;

DO $nul_guard$
DECLARE
  v_decoded TEXT;
  v_row RECORD;
  v_saw_live BOOLEAN := FALSE;
  v_saw_orphan BOOLEAN := FALSE;
BEGIN
  -- Encoded NUL bytes are valid stored text. Decoding must preserve
  -- the literal escape instead of calling chr(0), which raises
  -- outside the guarded conversion block and aborts every claim.
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);

  SELECT public.blog_media_percent_decode(
    '100% coverage, NUL: %00 done'
  ) INTO v_decoded;
  IF v_decoded <> '100% coverage, NUL: %00 done' THEN
    RAISE EXCEPTION 'NUL escape was not preserved: %', v_decoded;
  END IF;

  INSERT INTO public.blog_posts (
    title, slug, content, author_name, is_platform_post, merchant_id
  )
  VALUES (
    'NUL guard test',
    'sweep-claim-nul-guard-post',
    '100% coverage, NUL: %00, live ref https://cdn.example.com/media/platform/blog/nul-live.webp',
    'Editorial',
    TRUE,
    NULL
  );
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES
    ('platform/blog/nul-live.webp', now() - interval '2 hours', FALSE),
    ('platform/blog/nul-orphan.webp', now() - interval '2 hours', FALSE);

  FOR v_row IN
    SELECT tombstone_path, tombstone_claimed
      FROM public.claim_sweepable_blog_media_tombstones(
        now() - interval '1 hour',
        500
      )
  LOOP
    IF v_row.tombstone_path = 'platform/blog/nul-live.webp' THEN
      v_saw_live := TRUE;
      IF v_row.tombstone_claimed IS TRUE THEN
        RAISE EXCEPTION 'NUL field failed to protect a live object';
      END IF;
    ELSIF v_row.tombstone_path = 'platform/blog/nul-orphan.webp' THEN
      v_saw_orphan := TRUE;
      IF v_row.tombstone_claimed IS NOT TRUE THEN
        RAISE EXCEPTION 'claim skipped the NUL control orphan';
      END IF;
    END IF;
  END LOOP;
  IF NOT v_saw_live OR NOT v_saw_orphan THEN
    RAISE EXCEPTION 'claim omitted the NUL fixtures';
  END IF;

  DELETE FROM public.blog_posts
   WHERE slug = 'sweep-claim-nul-guard-post';
  DELETE FROM public.blog_media_delete_tombstones
   WHERE path IN (
    'platform/blog/nul-live.webp',
    'platform/blog/nul-orphan.webp'
  );
END;
$nul_guard$;

DO $unicode_unescape$
DECLARE
  v_decoded TEXT;
  v_row RECORD;
  v_saw_live BOOLEAN := FALSE;
  v_saw_orphan BOOLEAN := FALSE;
BEGIN
  -- Structured URLs escape characters as \u00XX; the storefront's
  -- JSON.parse resolves them to the live URL, so the scan must see
  -- the same characters or the sweep deletes a live image.
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);

  SELECT public.blog_media_json_unescape_string(
    'https:\/\/cdn.example.com\/media\/platform\/blog\/\u0074oken.webp'
  ) INTO v_decoded;
  IF v_decoded <>
    'https://cdn.example.com/media/platform/blog/token.webp'
  THEN
    RAISE EXCEPTION 'unicode unescape failed: %', v_decoded;
  END IF;
  SELECT public.blog_media_json_unescape_string('100\u0025') INTO v_decoded;
  IF v_decoded <> '100%' THEN
    RAISE EXCEPTION 'escaped percent failed: %', v_decoded;
  END IF;
  SELECT public.blog_media_json_unescape_string('a\u0000b') INTO v_decoded;
  IF v_decoded <> 'a\u0000b' THEN
    RAISE EXCEPTION 'NUL escape was not preserved: %', v_decoded;
  END IF;
  SELECT public.blog_media_json_unescape_string('x\u005cu002f')
  INTO v_decoded;
  IF v_decoded <> 'x\u002f' THEN
    RAISE EXCEPTION 'decoded output was rescanned: %', v_decoded;
  END IF;

  INSERT INTO public.blog_posts (
    title, slug, content, author_name, is_platform_post, merchant_id
  )
  VALUES (
    'Unicode unescape test',
    'sweep-claim-unicode-post',
    '{"src":"https:\/\/cdn.example.com\/media\/platform\/blog\/\u0074oken.webp"}',
    'Editorial',
    TRUE,
    NULL
  );
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES
    ('platform/blog/token.webp', now() - interval '2 hours', FALSE),
    ('platform/blog/uni-orphan.webp', now() - interval '2 hours', FALSE);

  FOR v_row IN
    SELECT tombstone_path, tombstone_claimed
      FROM public.claim_sweepable_blog_media_tombstones(
        now() - interval '1 hour',
        500
      )
  LOOP
    IF v_row.tombstone_path = 'platform/blog/token.webp' THEN
      v_saw_live := TRUE;
      IF v_row.tombstone_claimed IS TRUE THEN
        RAISE EXCEPTION 'unicode escapes failed to protect a live object';
      END IF;
    ELSIF v_row.tombstone_path = 'platform/blog/uni-orphan.webp' THEN
      v_saw_orphan := TRUE;
      IF v_row.tombstone_claimed IS NOT TRUE THEN
        RAISE EXCEPTION 'claim skipped the unicode control orphan';
      END IF;
    END IF;
  END LOOP;
  IF NOT v_saw_live OR NOT v_saw_orphan THEN
    RAISE EXCEPTION 'claim omitted the unicode fixtures';
  END IF;

  DELETE FROM public.blog_posts
   WHERE slug = 'sweep-claim-unicode-post';
  DELETE FROM public.blog_media_delete_tombstones
   WHERE path IN (
    'platform/blog/token.webp',
    'platform/blog/uni-orphan.webp'
  );
END;
$unicode_unescape$;

DO $html_entities$
DECLARE
  v_decoded TEXT;
  v_row RECORD;
  v_saw_live BOOLEAN := FALSE;
  v_saw_orphan BOOLEAN := FALSE;
BEGIN
  -- Persisted markup spells URLs with character references, which
  -- HTML parsing resolves to the live URL. The claim scan must see
  -- the same characters or the sweep deletes rendered media.
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);

  SELECT public.blog_media_decode_html_entities(
    'tok&#x65;n&#0000060;.webp'
  ) INTO v_decoded;
  IF v_decoded <> 'token<.webp' THEN
    RAISE EXCEPTION 'entity decode failed: %', v_decoded;
  END IF;
  SELECT public.blog_media_decode_html_entities(
    'a=1&amp;b&#0;c&#xD83D;d&#x110000;e&unknown;f&amp'
  ) INTO v_decoded;
  IF v_decoded <>
    'a=1&b&#0;c&#xD83D;d&#x110000;e&unknown;f&amp'
  THEN
    RAISE EXCEPTION 'entity preservation failed: %', v_decoded;
  END IF;
  SELECT public.blog_media_percent_decode(
    '<img src="https://cdn.example.com/media/platform/blog/tok&#x65;n.webp">'
  ) INTO v_decoded;
  IF v_decoded NOT LIKE '%platform/blog/token.webp%' THEN
    RAISE EXCEPTION 'chained entity decode failed: %', v_decoded;
  END IF;
  SELECT public.blog_media_decode_html_entities(
    'tok&#x65n&#0000060.webp a&#0b&#xD83Dz&#12345678'
  ) INTO v_decoded;
  IF v_decoded <> 'token<.webp a&#0b&#xD83Dz&#12345678' THEN
    RAISE EXCEPTION 'semicolonless entity decode failed: %', v_decoded;
  END IF;

  INSERT INTO public.blog_posts (
    title, slug, content, author_name, is_platform_post, merchant_id
  )
  VALUES (
    'HTML entity test',
    'sweep-claim-entity-post',
    '<img src="https://cdn.example.com/media/platform/blog/tok&#x65;n.webp">'
    '<img src="https://cdn.example.com/media/platform/blog/sem&#x69less.webp">',
    'Editorial',
    TRUE,
    NULL
  );
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES
    ('platform/blog/token.webp', now() - interval '2 hours', FALSE),
    ('platform/blog/semiless.webp', now() - interval '2 hours', FALSE),
    ('platform/blog/entity-orphan.webp', now() - interval '2 hours', FALSE);

  FOR v_row IN
    SELECT tombstone_path, tombstone_claimed
      FROM public.claim_sweepable_blog_media_tombstones(
        now() - interval '1 hour',
        500
      )
  LOOP
    IF v_row.tombstone_path = 'platform/blog/token.webp' THEN
      v_saw_live := TRUE;
      IF v_row.tombstone_claimed IS TRUE THEN
        RAISE EXCEPTION 'entities failed to protect a live object';
      END IF;
    ELSIF v_row.tombstone_path = 'platform/blog/semiless.webp' THEN
      IF v_row.tombstone_claimed IS TRUE THEN
        RAISE EXCEPTION 'semicolonless entities failed to protect a live object';
      END IF;
    ELSIF v_row.tombstone_path = 'platform/blog/entity-orphan.webp' THEN
      v_saw_orphan := TRUE;
      IF v_row.tombstone_claimed IS NOT TRUE THEN
        RAISE EXCEPTION 'claim skipped the entity control orphan';
      END IF;
    END IF;
  END LOOP;
  IF NOT v_saw_live OR NOT v_saw_orphan THEN
    RAISE EXCEPTION 'claim omitted the entity fixtures';
  END IF;

  DELETE FROM public.blog_posts
   WHERE slug = 'sweep-claim-entity-post';
  DELETE FROM public.blog_media_delete_tombstones
   WHERE path IN (
    'platform/blog/token.webp',
    'platform/blog/semiless.webp',
    'platform/blog/entity-orphan.webp'
  );
END;
$html_entities$;

DO $update_confinement$
DECLARE
  v_created_grant BOOLEAN;
  v_claimed_grant BOOLEAN;
  v_row_count INTEGER;
  v_message TEXT;
  v_saw_denial BOOLEAN := FALSE;
  v_saw_backdate_block BOOLEAN := FALSE;
BEGIN
  -- Direct-PostgREST regression: the heartbeat's created_at write
  -- succeeds while claimed/path rewrites die on the column grant,
  -- and lease backdates die on the monotonic trigger. RLS is held
  -- open by a rolled-back permissive policy so the test isolates
  -- grants and the trigger; the content.manage policy detail is
  -- orthogonal and covered by the refresh-route tests. Policy DDL
  -- runs as the session owner; the probes switch roles.
  RESET ROLE;
  -- UPDATE row selection reads through SELECT policies, so both
  -- sides open; the probes isolate grants and the trigger only.
  CREATE POLICY blog_media_grant_probe_open_update
    ON public.blog_media_delete_tombstones
    FOR UPDATE TO authenticated
    USING (TRUE)
    WITH CHECK (TRUE);
  CREATE POLICY blog_media_grant_probe_open_select
    ON public.blog_media_delete_tombstones
    FOR SELECT TO authenticated
    USING (TRUE);

  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);

  SELECT
    pg_catalog.has_column_privilege(
      'authenticated', 'public.blog_media_delete_tombstones',
      'created_at', 'UPDATE'
    ),
    pg_catalog.has_column_privilege(
      'authenticated', 'public.blog_media_delete_tombstones',
      'claimed', 'UPDATE'
    )
  INTO v_created_grant, v_claimed_grant;
  IF NOT v_created_grant THEN
    RAISE EXCEPTION 'heartbeat lost its created_at grant';
  END IF;
  IF v_claimed_grant THEN
    RAISE EXCEPTION 'claimed stayed writable through PostgREST';
  END IF;

  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES ('platform/blog/grant-probe.webp', now(), FALSE);

  SET LOCAL ROLE authenticated;
  UPDATE public.blog_media_delete_tombstones
     SET created_at = now() + interval '1 minute'
   WHERE path = 'platform/blog/grant-probe.webp';
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'heartbeat probe matched % rows', v_row_count;
  END IF;

  BEGIN
    UPDATE public.blog_media_delete_tombstones
       SET claimed = TRUE
     WHERE path = 'platform/blog/grant-probe.webp';
  EXCEPTION WHEN insufficient_privilege THEN
    v_saw_denial := TRUE;
  END;
  IF NOT v_saw_denial THEN
    RAISE EXCEPTION 'claimed rewrite was not denied';
  END IF;

  BEGIN
    UPDATE public.blog_media_delete_tombstones
       SET created_at = now() - interval '2 hours'
     WHERE path = 'platform/blog/grant-probe.webp';
  EXCEPTION WHEN insufficient_privilege THEN
    -- The trigger raises with the privilege-violation code; the
    -- message proves the trigger fired rather than the grant.
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_saw_backdate_block := (v_message = 'blog_media_lease_backdate_blocked');
  END;
  IF NOT v_saw_backdate_block THEN
    RAISE EXCEPTION 'lease backdate was not blocked';
  END IF;

  -- Worker-shaped writes (non-authenticated role) skip the trigger.
  RESET ROLE;
  SET LOCAL ROLE service_role;
  UPDATE public.blog_media_delete_tombstones
     SET created_at = now() - interval '2 hours'
   WHERE path = 'platform/blog/grant-probe.webp';

  RESET ROLE;
  DROP POLICY blog_media_grant_probe_open_update
    ON public.blog_media_delete_tombstones;
  DROP POLICY blog_media_grant_probe_open_select
    ON public.blog_media_delete_tombstones;
  DELETE FROM public.blog_media_delete_tombstones
   WHERE path = 'platform/blog/grant-probe.webp';
END;
$update_confinement$;

DO $lease_floor_walk$
DECLARE
  v_message TEXT;
  v_blocked_steps INTEGER := 0;
  v_aged INTERVAL;
BEGIN
  -- Incremental-walk regression: five-minute steps die on the
  -- server-time floor long before the one-hour cutoff. now() is
  -- transaction-constant here, so the first two steps land inside
  -- both tolerances and the third crosses the ten-minute floor
  -- and raises (in production, where each UPDATE is its own
  -- transaction, the walk dies a step earlier). Either way the
  -- walk can age a fresh upload by ten minutes at most.
  RESET ROLE;
  CREATE POLICY blog_media_floor_probe_open_update
    ON public.blog_media_delete_tombstones
    FOR UPDATE TO authenticated
    USING (TRUE)
    WITH CHECK (TRUE);
  CREATE POLICY blog_media_floor_probe_open_select
    ON public.blog_media_delete_tombstones
    FOR SELECT TO authenticated
    USING (TRUE);

  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);

  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES ('platform/blog/floor-probe.webp', now(), FALSE);

  SET LOCAL ROLE authenticated;
  UPDATE public.blog_media_delete_tombstones
     SET created_at = created_at - interval '5 minutes'
   WHERE path = 'platform/blog/floor-probe.webp';
  UPDATE public.blog_media_delete_tombstones
     SET created_at = created_at - interval '5 minutes'
   WHERE path = 'platform/blog/floor-probe.webp';

  BEGIN
    UPDATE public.blog_media_delete_tombstones
       SET created_at = created_at - interval '5 minutes'
     WHERE path = 'platform/blog/floor-probe.webp';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message = 'blog_media_lease_backdate_blocked' THEN
      v_blocked_steps := v_blocked_steps + 1;
    END IF;
  END;
  IF v_blocked_steps <> 1 THEN
    RAISE EXCEPTION 'floor walk third step was not blocked';
  END IF;

  SELECT now() - created_at INTO v_aged
    FROM public.blog_media_delete_tombstones
   WHERE path = 'platform/blog/floor-probe.webp';
  IF v_aged > interval '11 minutes' THEN
    RAISE EXCEPTION 'walk aged the lease by %', v_aged;
  END IF;

  RESET ROLE;
  DROP POLICY blog_media_floor_probe_open_update
    ON public.blog_media_delete_tombstones;
  DROP POLICY blog_media_floor_probe_open_select
    ON public.blog_media_delete_tombstones;
  DELETE FROM public.blog_media_delete_tombstones
   WHERE path = 'platform/blog/floor-probe.webp';
END;
$lease_floor_walk$;

DO $worker_scope$
DECLARE
  v_message TEXT;
  v_denied BOOLEAN;
BEGIN
  -- The pre-request hook confines the sweep worker to its two RPC
  -- paths: every other endpoint denies even with a leaked token.
  -- (Reload convergence is the probe script's job; this locks the
  -- hook logic, including the preserved GIGL branch.)
  RESET ROLE;

  -- Allowed worker calls pass silently.
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'blog_media_sweep_worker', true);
  PERFORM pg_catalog.set_config('request.method', 'POST', true);
  PERFORM pg_catalog.set_config('request.path', '/rpc/blog_media_sweep_worker_claim', true);
  PERFORM public.enforce_gigl_tracking_worker_request_scope();
  PERFORM pg_catalog.set_config('request.path', '/rpc/blog_media_sweep_worker_release', true);
  PERFORM public.enforce_gigl_tracking_worker_request_scope();

  -- Any other worker path denies, as does a non-POST method.
  PERFORM pg_catalog.set_config('request.path', '/rpc/blog_media_sweep_worker_can_delete', true);
  v_denied := FALSE;
  BEGIN
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_denied := (v_message = 'Blog media worker request is outside its capability scope');
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'worker scope guard admitted a third RPC';
  END IF;
  PERFORM pg_catalog.set_config('request.method', 'GET', true);
  PERFORM pg_catalog.set_config('request.path', '/rpc/blog_media_sweep_worker_claim', true);
  v_denied := FALSE;
  BEGIN
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := TRUE;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'worker scope guard admitted GET';
  END IF;

  -- The reload canary shadows for anonymous callers.
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
  PERFORM pg_catalog.set_config('request.method', 'POST', true);
  PERFORM pg_catalog.set_config('request.path', '/rpc/__blog_media_hook_reload_canary__', true);
  v_denied := FALSE;
  BEGIN
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_denied := (v_message = 'BLOG MEDIA hook reload canary observed');
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'blog canary did not shadow';
  END IF;

  -- Ordinary roles pass through untouched.
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM pg_catalog.set_config('request.path', '/rpc/anything', true);
  PERFORM public.enforce_gigl_tracking_worker_request_scope();

  -- The GIGL branch is preserved verbatim.
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'gigl_tracking_worker', true);
  PERFORM pg_catalog.set_config('request.path', '/rpc/gigl_worker_claim_due_tracking_monitors', true);
  PERFORM public.enforce_gigl_tracking_worker_request_scope();
  PERFORM pg_catalog.set_config('request.path', '/rpc/blog_media_sweep_worker_claim', true);
  v_denied := FALSE;
  BEGIN
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_denied := (v_message = 'GIGL worker request is outside its capability scope');
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'GIGL branch was not preserved';
  END IF;
END;
$worker_scope$;

DO $claim_prefilter_scale$
DECLARE
  v_row RECORD;
  v_count INTEGER := 0;
  v_saw_plain BOOLEAN := FALSE;
  v_saw_encoded BOOLEAN := FALSE;
  v_saw_entity BOOLEAN := FALSE;
  v_saw_json BOOLEAN := FALSE;
  v_saw_prefix_short BOOLEAN := FALSE;
  v_saw_prefix_long BOOLEAN := FALSE;
  v_saw_orphan BOOLEAN := FALSE;
BEGIN
  -- A full 500-path batch must protect references spelled every
  -- supported way while claiming the rest: the prefilter skips
  -- non-matching posts without changing exact-match semantics.
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);

  -- Earlier blocks share file-level tombstone fixtures; this block
  -- asserts an exact 500-row batch, so it starts from its fixtures
  -- alone. Everything rolls back with the file either way.
  DELETE FROM public.blog_media_delete_tombstones
   WHERE path NOT LIKE 'platform/blog/scale-%'
     AND path NOT IN ('platform/blog/pfix', 'platform/blog/pfix.webp');

  INSERT INTO public.blog_posts (
    title, slug, content, author_name, is_platform_post, merchant_id
  )
  VALUES (
    'Prefilter scale test',
    'sweep-claim-prefilter-post',
    '<img src="https://cdn.example.com/media/platform/blog/scale-plain.webp">'
    '<img src="https://cdn.example.com/media/platform/blog/scale-%65ncoded.webp">'
    '<img src="https://cdn.example.com/media/platform/blog/scale-&#x65;ntity.webp">'
    '{"src":"https:\/\/cdn.example.com\/media\/platform\/blog\/scale-\u006ason.webp"}'
    '<img src="https://cdn.example.com/media/platform/blog/pfix.webp">',
    'Editorial',
    TRUE,
    NULL
  );
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  SELECT 'platform/blog/scale-filler-' || seq || '.webp',
    now() - interval '2 hours', FALSE
    FROM pg_catalog.generate_series(1, 493) AS seq;
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES
    ('platform/blog/scale-plain.webp', now() - interval '2 hours', FALSE),
    ('platform/blog/scale-encoded.webp', now() - interval '2 hours', FALSE),
    ('platform/blog/scale-entity.webp', now() - interval '2 hours', FALSE),
    ('platform/blog/scale-json.webp', now() - interval '2 hours', FALSE),
    ('platform/blog/pfix', now() - interval '2 hours', FALSE),
    ('platform/blog/pfix.webp', now() - interval '2 hours', FALSE),
    ('platform/blog/scale-orphan.webp', now() - interval '2 hours', FALSE);

  FOR v_row IN
    SELECT tombstone_path, tombstone_claimed
      FROM public.claim_sweepable_blog_media_tombstones(
        now() - interval '1 hour',
        500
      )
  LOOP
    v_count := v_count + 1;
    IF v_row.tombstone_path = 'platform/blog/scale-plain.webp' THEN
      v_saw_plain := TRUE;
      IF v_row.tombstone_claimed IS TRUE THEN
        RAISE EXCEPTION 'prefilter dropped a plain reference';
      END IF;
    ELSIF v_row.tombstone_path = 'platform/blog/scale-encoded.webp' THEN
      v_saw_encoded := TRUE;
      IF v_row.tombstone_claimed IS TRUE THEN
        RAISE EXCEPTION 'prefilter dropped an encoded reference';
      END IF;
    ELSIF v_row.tombstone_path = 'platform/blog/scale-entity.webp' THEN
      v_saw_entity := TRUE;
      IF v_row.tombstone_claimed IS TRUE THEN
        RAISE EXCEPTION 'prefilter dropped an entity reference';
      END IF;
    ELSIF v_row.tombstone_path = 'platform/blog/scale-json.webp' THEN
      v_saw_json := TRUE;
      IF v_row.tombstone_claimed IS TRUE THEN
        RAISE EXCEPTION 'prefilter dropped a JSON reference';
      END IF;
    ELSIF v_row.tombstone_path = 'platform/blog/pfix' THEN
      v_saw_prefix_short := TRUE;
      -- Substring semantics preserved: the shorter path's text
      -- appears inside the longer URL, so both stay protected.
      IF v_row.tombstone_claimed IS TRUE THEN
        RAISE EXCEPTION 'prefilter changed prefix semantics';
      END IF;
    ELSIF v_row.tombstone_path = 'platform/blog/pfix.webp' THEN
      v_saw_prefix_long := TRUE;
      IF v_row.tombstone_claimed IS TRUE THEN
        RAISE EXCEPTION 'prefilter dropped the longer prefix path';
      END IF;
    ELSIF v_row.tombstone_path = 'platform/blog/scale-orphan.webp' THEN
      v_saw_orphan := TRUE;
      IF v_row.tombstone_claimed IS NOT TRUE THEN
        RAISE EXCEPTION 'claim skipped the scale control orphan';
      END IF;
    END IF;
  END LOOP;
  IF v_count <> 500 THEN
    RAISE EXCEPTION 'claim returned % of 500 tombstones', v_count;
  END IF;
  IF NOT v_saw_plain OR NOT v_saw_encoded OR NOT v_saw_entity
    OR NOT v_saw_json OR NOT v_saw_prefix_short OR NOT v_saw_prefix_long
    OR NOT v_saw_orphan
  THEN
    RAISE EXCEPTION 'claim omitted scale fixtures';
  END IF;

  DELETE FROM public.blog_posts
   WHERE slug = 'sweep-claim-prefilter-post';
  DELETE FROM public.blog_media_delete_tombstones
   WHERE path LIKE 'platform/blog/scale-%'
      OR path IN ('platform/blog/pfix', 'platform/blog/pfix.webp');
END;
$claim_prefilter_scale$;

DO $platform_patch_atomic$
DECLARE
  v_post_id UUID;
  v_row RECORD;
  v_message TEXT;
  v_saw_not_found BOOLEAN := FALSE;
  v_saw_unknown BOOLEAN := FALSE;
  v_saw_swept BOOLEAN := FALSE;
BEGIN
  -- A failed platform PATCH persists nothing: the row update and
  -- its media verification share one transaction, so title, slug,
  -- status, and published_at roll back with the media failure
  -- instead of committing under a 500. Runs as the table owner so
  -- RLS (unchanged INVOKER semantics) stays out of the way; the
  -- route tests cover the permission path through PostgREST.
  RESET ROLE;

  INSERT INTO public.blog_posts (
    title, slug, content, status, is_platform_post, merchant_id,
    published_at, author_name
  )
  VALUES (
    'Atomic draft', 'atomic-draft',
    '<img src="https://cdn.example.com/media/platform/blog/atomic-live.webp">',
    'draft', TRUE, NULL, NULL, 'Atomic Author'
  )
  RETURNING id INTO v_post_id;
  INSERT INTO storage.objects (bucket_id, name, owner, version, metadata)
  VALUES ('media', 'platform/blog/atomic-live.webp', NULL, '1', '{}');
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES ('platform/blog/atomic-live.webp', now() - interval '2 hours', FALSE);

  -- Success clears the tombstone and returns the merged row.
  SELECT * INTO v_row
    FROM public.mutate_platform_blog_post_atomic(
      v_post_id,
      '{"title": "Atomic updated", "status": "published",'
      ' "published_at": "2026-10-09T10:00:00+00:00",'
      ' "word_count": 42, "tags": ["a", "b"]}',
      ARRAY['platform/blog/atomic-live.webp']
    );
  IF v_row.title <> 'Atomic updated' OR v_row.status <> 'published'
    OR v_row.word_count <> 42 OR v_row.tags <> ARRAY['a', 'b']
    OR v_row.slug <> 'atomic-draft'
  THEN
    RAISE EXCEPTION 'atomic update returned the wrong row';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.blog_media_delete_tombstones
     WHERE path = 'platform/blog/atomic-live.webp'
  ) THEN
    RAISE EXCEPTION 'atomic update left the tombstone behind';
  END IF;

  -- A swept reference rolls the whole PATCH back: every column,
  -- including non-media ones, keeps its pre-save value.
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES ('platform/blog/atomic-doomed.webp', now() - interval '2 hours', TRUE);
  BEGIN
    PERFORM public.mutate_platform_blog_post_atomic(
      v_post_id,
      '{"title": "Doomed title", "slug": "doomed-slug",'
      ' "status": "published", "content": "<img src='''
      'https://cdn.example.com/media/platform/blog/atomic-doomed.webp''>"}',
      ARRAY['platform/blog/atomic-doomed.webp']
    );
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_saw_swept := (v_message LIKE 'platform_blog_media_swept_during_save%');
  END;
  IF NOT v_saw_swept THEN
    RAISE EXCEPTION 'swept media did not fail the PATCH';
  END IF;
  SELECT title, slug, status, content INTO v_row
    FROM public.blog_posts WHERE id = v_post_id;
  IF v_row.title <> 'Atomic updated' OR v_row.slug <> 'atomic-draft'
    OR v_row.status <> 'published' OR v_row.content LIKE '%Doomed%'
  THEN
    RAISE EXCEPTION 'failed PATCH persisted a partial row: %', v_row.title;
  END IF;

  -- Stale candidate paths (absent from the final row) neither
  -- resurrect tombstones nor fail the save.
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES ('platform/blog/atomic-stale.webp', now() - interval '2 hours', FALSE);
  PERFORM public.mutate_platform_blog_post_atomic(
    v_post_id,
    '{"title": "Atomic final"}',
    ARRAY['platform/blog/atomic-stale.webp', 'platform/blog/atomic-live.webp']
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.blog_media_delete_tombstones
     WHERE path = 'platform/blog/atomic-stale.webp'
  ) THEN
    RAISE EXCEPTION 'stale candidate resurrected a tombstone';
  END IF;

  -- Unknown fields fail closed instead of reaching the UPDATE.
  BEGIN
    PERFORM public.mutate_platform_blog_post_atomic(
      v_post_id, '{"embedded_products": [1]}',
      ARRAY[]::TEXT[]
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_saw_unknown := (v_message LIKE 'platform_blog_post_unknown_field%');
  END;
  IF NOT v_saw_unknown THEN
    RAISE EXCEPTION 'unknown field was not rejected';
  END IF;

  -- Missing rows are not found (merchant-owned rows fail the same
  -- scope predicate).
  BEGIN
    PERFORM public.mutate_platform_blog_post_atomic(
      '00000000-0000-0000-0000-000000000000', '{"title": "x"}',
      ARRAY[]::TEXT[]
    );
  EXCEPTION WHEN no_data_found THEN
    v_saw_not_found := TRUE;
  END;
  IF NOT v_saw_not_found THEN
    RAISE EXCEPTION 'missing post was not rejected';
  END IF;

  DELETE FROM storage.objects
   WHERE bucket_id = 'media' AND name = 'platform/blog/atomic-live.webp';
  DELETE FROM public.blog_media_delete_tombstones
   WHERE path IN (
    'platform/blog/atomic-live.webp', 'platform/blog/atomic-doomed.webp',
    'platform/blog/atomic-stale.webp'
  );
  DELETE FROM public.blog_posts WHERE id = v_post_id;
END;
$platform_patch_atomic$;

DO $platform_create_atomic$
DECLARE
  v_row RECORD;
  v_message TEXT;
  v_saw_swept BOOLEAN := FALSE;
  v_saw_unknown BOOLEAN := FALSE;
BEGIN
  -- A failed platform create persists nothing: the insert and its
  -- media verification share one transaction, so no compensating
  -- delete can fail and no slug lingers for the retry. Runs as the
  -- table owner so RLS (unchanged INVOKER semantics) stays out of
  -- the way; the route tests cover the permission path.
  RESET ROLE;

  INSERT INTO storage.objects (bucket_id, name, owner, version, metadata)
  VALUES ('media', 'platform/blog/atomic-create-live.webp', NULL, '1', '{}');
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES ('platform/blog/atomic-create-live.webp', now() - interval '2 hours', FALSE);

  -- Success clears the tombstone and returns the inserted row with
  -- forced platform scope.
  SELECT * INTO v_row
    FROM public.mutate_platform_blog_post_create_atomic(
      '{"title": "Atomic create", "slug": "atomic-create",'
      ' "content": "<img src=\"https://cdn.example.com/media/platform/blog/atomic-create-live.webp\">",'
      ' "author_name": "Atomic Author", "word_count": 7, "tags": ["c"]}',
      ARRAY['platform/blog/atomic-create-live.webp']
    );
  IF v_row.title <> 'Atomic create' OR v_row.slug <> 'atomic-create'
    OR v_row.word_count <> 7 OR v_row.tags <> ARRAY['c']
  THEN
    RAISE EXCEPTION 'atomic create returned the wrong row';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.blog_posts AS post
     WHERE post.slug = 'atomic-create'
       AND (post.is_platform_post IS NOT TRUE OR post.merchant_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'atomic create did not force platform scope';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.blog_media_delete_tombstones
     WHERE path = 'platform/blog/atomic-create-live.webp'
  ) THEN
    RAISE EXCEPTION 'atomic create left the tombstone behind';
  END IF;

  -- A swept reference rolls the whole create back: no row persists,
  -- so the retry meets no slug conflict.
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES ('platform/blog/atomic-create-doomed.webp', now() - interval '2 hours', TRUE);
  BEGIN
    PERFORM public.mutate_platform_blog_post_create_atomic(
      '{"title": "Doomed create", "slug": "doomed-create",'
      ' "content": "<img src=\"https://cdn.example.com/media/platform/blog/atomic-create-doomed.webp\">",'
      ' "author_name": "Atomic Author"}',
      ARRAY['platform/blog/atomic-create-doomed.webp']
    );
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_saw_swept := (v_message LIKE 'platform_blog_media_swept_during_save%');
  END;
  IF NOT v_saw_swept THEN
    RAISE EXCEPTION 'swept media did not fail the create';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.blog_posts WHERE slug = 'doomed-create'
  ) THEN
    RAISE EXCEPTION 'failed create left a row behind';
  END IF;

  -- Unknown fields are rejected, not silently dropped.
  BEGIN
    PERFORM public.mutate_platform_blog_post_create_atomic(
      '{"title": "X", "nope": 1}',
      ARRAY[]::TEXT[]
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_saw_unknown := TRUE;
  END;
  IF NOT v_saw_unknown THEN
    RAISE EXCEPTION 'unknown field was not rejected';
  END IF;

  DELETE FROM storage.objects
   WHERE bucket_id = 'media' AND name = 'platform/blog/atomic-create-live.webp';
  DELETE FROM public.blog_media_delete_tombstones
   WHERE path IN (
    'platform/blog/atomic-create-live.webp', 'platform/blog/atomic-create-doomed.webp'
  );
  DELETE FROM public.blog_posts WHERE slug = 'atomic-create';
END;
$platform_create_atomic$;

DO $direct_write_guard$
DECLARE
  v_message TEXT;
  v_saw_platform BOOLEAN := FALSE;
  v_saw_update BOOLEAN := FALSE;
  v_saw_merchant BOOLEAN := FALSE;
BEGIN
  -- Direct-write regression: a post that commits after the claim
  -- snapshot but before byte removal must fail like an RPC-side
  -- swept failure instead of re-referencing a doomed path the
  -- delete policy still admits. Runs as the table owner; the
  -- trigger is DEFINER and sees claimed rows for every caller.
  RESET ROLE;

  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES ('platform/blog/guard-doomed.webp', now() - interval '2 hours', TRUE);
  INSERT INTO public.blog_media_delete_tombstones (path, created_at, claimed)
  VALUES ('platform/blog/guard-live.webp', now(), FALSE);

  -- A direct platform INSERT referencing a claimed path aborts.
  BEGIN
    INSERT INTO public.blog_posts (
      title, slug, content, status, is_platform_post, merchant_id,
      author_name
    )
    VALUES (
      'Guard draft', 'guard-draft',
      '<img src="https://cdn.example.com/media/platform/blog/guard-doomed.webp">',
      'draft', TRUE, NULL, 'Guard Author'
    );
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_saw_platform := (v_message LIKE 'platform_blog_media_swept_during_save%');
  END;
  IF NOT v_saw_platform THEN
    RAISE EXCEPTION 'direct insert over a claimed path was not blocked';
  END IF;

  -- So does a direct UPDATE that newly references one.
  INSERT INTO public.blog_posts (
    title, slug, content, status, is_platform_post, merchant_id,
    author_name
  )
  VALUES (
    'Guard clean', 'guard-clean', '<p>Clean</p>',
    'draft', TRUE, NULL, 'Guard Author'
  );
  BEGIN
    UPDATE public.blog_posts
       SET content = '<img src="https://cdn.example.com/media/platform/blog/guard-doomed.webp">'
     WHERE slug = 'guard-clean';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_saw_update := (v_message LIKE 'platform_blog_media_swept_during_save%');
  END;
  IF NOT v_saw_update THEN
    RAISE EXCEPTION 'direct update over a claimed path was not blocked';
  END IF;

  -- Merchant rows get the merchant-side failure for the same race.
  BEGIN
    INSERT INTO public.blog_posts (
      title, slug, content, status, is_platform_post, merchant_id,
      author_name
    )
    VALUES (
      'Guard merchant', 'guard-merchant',
      '<img src="https://cdn.example.com/media/platform/blog/guard-doomed.webp">',
      'draft', FALSE, '00000000-0000-0000-0000-000000000001', 'Guard Author'
    );
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_saw_merchant := (v_message LIKE 'merchant_blog_media_swept_during_save%');
  END;
  IF NOT v_saw_merchant THEN
    RAISE EXCEPTION 'merchant direct write over a claimed path was not blocked';
  END IF;

  -- Unclaimed references pass: the claim scan, not the trigger,
  -- owns them.
  INSERT INTO public.blog_posts (
    title, slug, content, status, is_platform_post, merchant_id,
    author_name
  )
  VALUES (
    'Guard live', 'guard-live',
    '<img src="https://cdn.example.com/media/platform/blog/guard-live.webp">',
    'draft', TRUE, NULL, 'Guard Author'
  );

  -- The guard locks referenced rows, not just reads them: the
  -- unclaimed tombstone above must carry this transaction's row
  -- lock, serializing the write against a concurrent claim.
  IF NOT EXISTS (
    SELECT 1 FROM public.blog_media_delete_tombstones
     WHERE path = 'platform/blog/guard-live.webp'
       AND xmax::text <> '0'
  ) THEN
    RAISE EXCEPTION 'direct-write guard did not lock the referenced tombstone';
  END IF;

  DELETE FROM public.blog_media_delete_tombstones
   WHERE path IN ('platform/blog/guard-doomed.webp', 'platform/blog/guard-live.webp');
  DELETE FROM public.blog_posts
   WHERE slug IN ('guard-clean', 'guard-live');
END;
$direct_write_guard$;

RESET ROLE;

ROLLBACK;

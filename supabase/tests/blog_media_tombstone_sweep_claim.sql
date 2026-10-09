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

RESET ROLE;

ROLLBACK;

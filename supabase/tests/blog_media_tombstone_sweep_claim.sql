-- ================================================================
-- REGRESSION TEST: atomic tombstone sweep claim and save-path probe
--
-- USAGE:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/blog_media_tombstone_sweep_claim.sql
-- ================================================================

BEGIN;

INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
VALUES
  ('media', 'platform/blog/stale.webp', NULL, NULL, '{}'::jsonb),
  ('media', 'platform/blog/kept.webp', NULL, NULL, '{}'::jsonb),
  ('media', 'platform/blog/fresh.webp', NULL, NULL, '{}'::jsonb),
  ('media', 'platform/blog/special_%_name.webp', NULL, NULL, '{}'::jsonb);

INSERT INTO public.blog_media_delete_tombstones (path, created_at)
VALUES
  ('platform/blog/stale.webp', now() - interval '2 hours'),
  ('platform/blog/kept.webp', now() - interval '2 hours'),
  ('platform/blog/fresh.webp', now() - interval '10 minutes'),
  ('platform/blog/special_%_name.webp', now() - interval '2 hours');

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
    IF v_row.tombstone_path = 'platform/blog/stale.webp'
      AND v_row.tombstone_claimed IS TRUE
    THEN
      v_claimed_count := v_claimed_count + 1;
    ELSIF v_row.tombstone_path = 'platform/blog/special_%_name.webp'
      AND v_row.tombstone_claimed IS TRUE
    THEN
      v_claimed_count := v_claimed_count + 1;
    ELSIF v_row.tombstone_path = 'platform/blog/kept.webp'
      AND v_row.tombstone_claimed IS FALSE
    THEN
      CONTINUE;
    ELSE
      RAISE EXCEPTION
        'unexpected claim row: % claimed=%',
        v_row.tombstone_path,
        v_row.tombstone_claimed;
    END IF;
  END LOOP;

  IF v_total_count <> 3 THEN
    RAISE EXCEPTION 'claim must return exactly the 3 due rows, got %', v_total_count;
  END IF;
  IF v_claimed_count <> 2 THEN
    RAISE EXCEPTION 'claim must claim exactly stale + special, got %', v_claimed_count;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.blog_media_delete_tombstones
     WHERE path <> 'platform/blog/fresh.webp'
  ) THEN
    RAISE EXCEPTION 'claim must leave only the fresh tombstone row';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM storage.objects
     WHERE bucket_id = 'media'
       AND name IN ('platform/blog/stale.webp', 'platform/blog/special_%_name.webp')
  ) THEN
    RAISE EXCEPTION 'claim must drop metadata for claimed objects';
  END IF;

  IF (
    SELECT count(*)
      FROM storage.objects
     WHERE bucket_id = 'media'
       AND name IN ('platform/blog/kept.webp', 'platform/blog/fresh.webp')
  ) <> 2 THEN
    RAISE EXCEPTION 'claim must keep metadata for resurrected and fresh objects';
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
  IF v_present_count <> 2 THEN
    RAISE EXCEPTION 'presence probe must report kept + fresh only, got %', v_present_count;
  END IF;

  SELECT count(*)
    INTO v_present_count
    FROM public.blog_media_objects_present_v1(ARRAY[]::text[]);
  IF v_present_count <> 0 THEN
    RAISE EXCEPTION 'presence probe must report nothing for an empty input';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.claim_sweepable_blog_media_tombstones(
        now() - interval '1 hour',
        500
      )
  ) THEN
    RAISE EXCEPTION 'second claim must return no rows once staging is empty';
  END IF;
END;
$probe$;

DO $grants$
BEGIN
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
END;
$grants$;

RESET ROLE;

ROLLBACK;

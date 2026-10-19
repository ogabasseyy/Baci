-- Mutate a platform blog post atomically: the row update and its
-- media verification commit or roll back together, so a failed
-- PATCH persists nothing instead of leaving title, slug, status,
-- and published_at committed while the UI reports failure. The row
-- lock serializes concurrent PATCHes on the same post (the loser's
-- statement waits, then operates on the winner's committed row),
-- which removes the restore race windows entirely — there is no
-- compensation step left to race. SECURITY INVOKER keeps the
-- caller's RLS: the lock read and the update obey the platform
-- SELECT/UPDATE policies exactly like the direct PostgREST update
-- this replaces.
--
-- p_post_data carries only the columns to change (anything else
-- raises); provided JSON nulls clear their column. p_media_paths is
-- a candidate superset computed from the pre-read row plus the
-- write: each path registers only if it still appears in the locked
-- updated row, so a concurrent save's removals can neither leak
-- resurrections nor fail this save. Media referenced nowhere in the
-- final row stays unregistered and sweeps on schedule.
CREATE OR REPLACE FUNCTION public.mutate_platform_blog_post_atomic(
  p_post_id UUID,
  p_post_data JSONB,
  p_media_paths TEXT[]
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  slug TEXT,
  content TEXT,
  excerpt TEXT,
  featured_image_url TEXT,
  featured_image_alt TEXT,
  featured_image_width INTEGER,
  featured_image_height INTEGER,
  featured_image_variants JSONB,
  category TEXT,
  tags TEXT[],
  keywords TEXT[],
  author_name TEXT,
  author_title TEXT,
  author_image_url TEXT,
  author_bio TEXT,
  status TEXT,
  seo_title TEXT,
  seo_description TEXT,
  focus_keyword TEXT,
  intent TEXT,
  intent_source TEXT,
  word_count INTEGER,
  reading_time_minutes INTEGER,
  view_count INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_key TEXT;
  v_assignments TEXT[] := '{}';
  v_updated RECORD;
  v_candidate TEXT;
  v_live TEXT[] := '{}';
  v_decoded_content TEXT;
  v_decoded_excerpt TEXT;
  v_decoded_featured TEXT;
  v_decoded_author TEXT;
  v_decoded_variants TEXT;
  v_lost TEXT[];
BEGIN
  -- Lock and re-check scope on the latest committed version: a
  -- concurrent PATCH that committed first is simply the row we now
  -- see, and our keys apply onto it.
  PERFORM 1
    FROM public.blog_posts AS post
   WHERE post.id = p_post_id
     AND post.is_platform_post IS TRUE
     AND post.merchant_id IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_blog_post_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_post_data) LOOP
    -- Text columns.
    IF v_key IN (
      'title', 'slug', 'content', 'excerpt', 'featured_image_url',
      'featured_image_alt', 'intent', 'intent_source', 'category',
      'author_name', 'author_title', 'author_image_url', 'author_bio',
      'status', 'seo_title', 'seo_description', 'focus_keyword'
    ) THEN
      v_assignments := v_assignments || pg_catalog.format(
        '%I = ($1 ->> %L)', v_key, v_key);
    -- Integer columns.
    ELSIF v_key IN (
      'featured_image_width', 'featured_image_height', 'word_count',
      'reading_time_minutes'
    ) THEN
      v_assignments := v_assignments || pg_catalog.format(
        '%I = (($1 ->> %L)::integer)', v_key, v_key);
    -- Timestamps.
    ELSIF v_key = 'published_at' THEN
      v_assignments := v_assignments || pg_catalog.format(
        '%I = (($1 ->> %L)::timestamptz)', v_key, v_key);
    -- Text arrays: JSON null clears, arrays convert element-wise.
    ELSIF v_key IN ('tags', 'keywords') THEN
      v_assignments := v_assignments || pg_catalog.format(
        '%I = (CASE WHEN ($1 -> %L) IS NULL OR ($1 -> %L) = ''null''::jsonb'
        ' THEN NULL ELSE ARRAY(SELECT pg_catalog.jsonb_array_elements_text($1 -> %L)) END)',
        v_key, v_key, v_key, v_key);
    -- JSON document: JSON null clears to SQL NULL.
    ELSIF v_key = 'featured_image_variants' THEN
      v_assignments := v_assignments || pg_catalog.format(
        '%I = NULLIF(($1 -> %L), ''null''::jsonb)', v_key, v_key);
    ELSE
      RAISE EXCEPTION 'platform_blog_post_unknown_field: %', v_key
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF pg_catalog.array_length(v_assignments, 1) IS NULL THEN
    RAISE EXCEPTION 'platform_blog_post_empty_update'
      USING ERRCODE = '22023';
  END IF;

  EXECUTE 'UPDATE public.blog_posts AS post SET '
    || pg_catalog.array_to_string(v_assignments, ', ')
    || ' WHERE post.id = $2 AND post.is_platform_post IS TRUE'
    || ' AND post.merchant_id IS NULL'
    USING p_post_data, p_post_id;

  -- Intersect the candidate paths with the locked updated row: only
  -- paths the final row actually references register. The decode
  -- pipeline matches the sweep claim's, so protection agrees.
  SELECT post.content, post.excerpt, post.featured_image_url,
    post.author_image_url, post.featured_image_variants::text
    INTO v_updated
    FROM public.blog_posts AS post
   WHERE post.id = p_post_id;
  v_decoded_content :=
    public.blog_media_percent_decode(v_updated.content);
  v_decoded_excerpt :=
    public.blog_media_percent_decode(v_updated.excerpt);
  v_decoded_featured :=
    public.blog_media_percent_decode(v_updated.featured_image_url);
  v_decoded_author :=
    public.blog_media_percent_decode(v_updated.author_image_url);
  v_decoded_variants :=
    public.blog_media_percent_decode(v_updated.featured_image_variants);
  IF p_media_paths IS NOT NULL THEN
    FOREACH v_candidate IN ARRAY p_media_paths LOOP
      IF v_candidate IS NOT NULL
        AND (
          pg_catalog.strpos(v_decoded_content, v_candidate) > 0
          OR pg_catalog.strpos(v_decoded_excerpt, v_candidate) > 0
          OR pg_catalog.strpos(v_decoded_featured, v_candidate) > 0
          OR pg_catalog.strpos(v_decoded_author, v_candidate) > 0
          OR pg_catalog.strpos(v_decoded_variants, v_candidate) > 0
        )
      THEN
        v_live := v_live || v_candidate;
      END IF;
    END LOOP;
  END IF;

  SELECT pg_catalog.array_agg(registration.path)
    INTO v_lost
    FROM public.register_blog_media_references_v1(v_live) AS registration
   WHERE registration.status <> 'cleared';
  IF v_lost IS NOT NULL THEN
    RAISE EXCEPTION 'platform_blog_media_swept_during_save: %',
      pg_catalog.array_to_string(v_lost, ', ')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT post.id, post.title, post.slug, post.content, post.excerpt,
    post.featured_image_url, post.featured_image_alt,
    post.featured_image_width, post.featured_image_height,
    post.featured_image_variants, post.category, post.tags,
    post.keywords, post.author_name, post.author_title,
    post.author_image_url, post.author_bio, post.status,
    post.seo_title, post.seo_description, post.focus_keyword,
    post.intent, post.intent_source, post.word_count,
    post.reading_time_minutes, post.view_count, post.created_at,
    post.updated_at, post.published_at
    FROM public.blog_posts AS post
   WHERE post.id = p_post_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.mutate_platform_blog_post_atomic(UUID, JSONB, TEXT[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mutate_platform_blog_post_atomic(UUID, JSONB, TEXT[])
  TO authenticated, service_role;

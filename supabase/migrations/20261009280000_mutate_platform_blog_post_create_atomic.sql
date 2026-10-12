-- Create a platform blog post atomically: the row insert and its
-- media verification commit or roll back together, so a failed
-- create persists nothing instead of leaving a compensating delete
-- to race the same transient that broke verification. SECURITY
-- INVOKER keeps the caller's RLS: the insert obeys the platform
-- INSERT policy exactly like the direct PostgREST insert this
-- replaces, and scope is forced in SQL (is_platform_post TRUE,
-- merchant_id NULL) rather than trusted from the payload.
--
-- p_post_data carries the columns to set (anything else raises);
-- omitted columns take their database defaults and provided JSON
-- nulls store SQL NULL. p_media_paths is a candidate superset: each
-- path registers only if it appears in the inserted row, so stale
-- candidates simply fail to intersect while live ones register.
CREATE OR REPLACE FUNCTION public.mutate_platform_blog_post_create_atomic(
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
  v_columns TEXT[] := '{}';
  v_values TEXT[] := '{}';
  v_post_id UUID;
  v_candidate TEXT;
  v_live TEXT[] := '{}';
  v_inserted RECORD;
  v_decoded_content TEXT;
  v_decoded_excerpt TEXT;
  v_decoded_featured TEXT;
  v_decoded_author TEXT;
  v_decoded_variants TEXT;
  v_lost TEXT[];
BEGIN
  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_post_data) LOOP
    -- Text columns.
    IF v_key IN (
      'title', 'slug', 'content', 'excerpt', 'featured_image_url',
      'featured_image_alt', 'intent', 'intent_source', 'category',
      'author_name', 'author_title', 'author_image_url', 'author_bio',
      'status', 'seo_title', 'seo_description', 'focus_keyword'
    ) THEN
      v_columns := v_columns || pg_catalog.quote_ident(v_key);
      v_values := v_values || pg_catalog.format('($1 ->> %L)', v_key);
    -- Integer columns.
    ELSIF v_key IN (
      'featured_image_width', 'featured_image_height', 'word_count',
      'reading_time_minutes'
    ) THEN
      v_columns := v_columns || pg_catalog.quote_ident(v_key);
      v_values := v_values || pg_catalog.format(
        '(($1 ->> %L)::integer)', v_key);
    -- Timestamps.
    ELSIF v_key = 'published_at' THEN
      v_columns := v_columns || pg_catalog.quote_ident(v_key);
      v_values := v_values || pg_catalog.format(
        '(($1 ->> %L)::timestamptz)', v_key);
    -- Text arrays: JSON null clears, arrays convert element-wise.
    ELSIF v_key IN ('tags', 'keywords') THEN
      v_columns := v_columns || pg_catalog.quote_ident(v_key);
      v_values := v_values || pg_catalog.format(
        '(CASE WHEN ($1 -> %L) IS NULL OR ($1 -> %L) = ''null''::jsonb'
        ' THEN NULL ELSE ARRAY(SELECT pg_catalog.jsonb_array_elements_text($1 -> %L)) END)',
        v_key, v_key, v_key);
    -- JSON document: JSON null clears to SQL NULL.
    ELSIF v_key = 'featured_image_variants' THEN
      v_columns := v_columns || pg_catalog.quote_ident(v_key);
      v_values := v_values || pg_catalog.format(
        'NULLIF(($1 -> %L), ''null''::jsonb)', v_key);
    ELSE
      RAISE EXCEPTION 'platform_blog_post_unknown_field: %', v_key
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  EXECUTE 'INSERT INTO public.blog_posts ('
    || CASE WHEN pg_catalog.array_length(v_columns, 1) IS NULL THEN ''
      ELSE pg_catalog.array_to_string(v_columns, ', ') || ', ' END
    || 'is_platform_post, merchant_id) SELECT '
    || CASE WHEN pg_catalog.array_length(v_values, 1) IS NULL THEN ''
      ELSE pg_catalog.array_to_string(v_values, ', ') || ', ' END
    || 'TRUE, NULL RETURNING id'
    INTO v_post_id
    USING p_post_data;

  -- Intersect the candidate paths with the inserted row: only
  -- paths the final row actually references register. The decode
  -- pipeline matches the sweep claim's, so protection agrees.
  SELECT post.content, post.excerpt, post.featured_image_url,
    post.author_image_url, post.featured_image_variants::text
    INTO v_inserted
    FROM public.blog_posts AS post
   WHERE post.id = v_post_id;
  v_decoded_content :=
    public.blog_media_percent_decode(v_inserted.content);
  v_decoded_excerpt :=
    public.blog_media_percent_decode(v_inserted.excerpt);
  v_decoded_featured :=
    public.blog_media_percent_decode(v_inserted.featured_image_url);
  v_decoded_author :=
    public.blog_media_percent_decode(v_inserted.author_image_url);
  v_decoded_variants :=
    public.blog_media_percent_decode(v_inserted.featured_image_variants);
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
   WHERE post.id = v_post_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.mutate_platform_blog_post_create_atomic(JSONB, TEXT[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mutate_platform_blog_post_create_atomic(JSONB, TEXT[])
  TO authenticated, service_role;

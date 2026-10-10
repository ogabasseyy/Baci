-- Decode percent-encoded media references before the sweep's
-- reference scan. Stored URLs may encode path segments
-- (%74oken.webp) while tombstone candidates arrive decoded, so the
-- claim's literal strpos misses the live reference and the sweep
-- deletes bytes backing a published post. Decoding runs once per
-- row per field, then the candidate checks match against decoded
-- text; malformed escapes and non-UTF8 byte runs fall back to the
-- raw text, preserving the previous literal behavior.
CREATE OR REPLACE FUNCTION public.blog_media_percent_decode(value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_text TEXT;
  v_hex TEXT;
  v_changed BOOLEAN;
  v_pass INTEGER;
BEGIN
  IF pg_catalog.strpos(value, '%') = 0 THEN
    RETURN value;
  END IF;
  -- View the raw UTF8 bytes as Latin-1 so every byte is a splicing
  -- character: each %XX becomes the single byte it encodes, and
  -- literal non-ASCII text round-trips untouched. Up to three passes
  -- match the application scan's fixpoint for multiply-encoded URLs.
  v_text := pg_catalog.convert_from(
    pg_catalog.convert_to(value, 'UTF8'), 'LATIN1');
  FOR v_pass IN 1..3 LOOP
    EXIT WHEN v_text NOT LIKE '%\%%' ESCAPE '\';
    v_changed := FALSE;
    FOR v_hex IN
      SELECT DISTINCT m[1]
        FROM pg_catalog.regexp_matches(
          v_text, '%([0-9A-Fa-f]{2})', 'g') AS m
    LOOP
      v_text := pg_catalog.replace(
        v_text, '%' || v_hex,
        pg_catalog.chr(('x' || v_hex)::bit(8)::int));
      v_changed := TRUE;
    END LOOP;
    EXIT WHEN NOT v_changed;
  END LOOP;
  BEGIN
    RETURN pg_catalog.convert_from(
      pg_catalog.convert_to(v_text, 'LATIN1'), 'UTF8');
  EXCEPTION WHEN OTHERS THEN
    -- Undecodable runs (a bare %FF, a null byte, split UTF8) fall
    -- back to literal matching, preserving previous behavior.
    RETURN value;
  END;
END;
$function$;

ALTER FUNCTION public.blog_media_percent_decode(TEXT) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.claim_sweepable_blog_media_tombstones(
  p_cutoff TIMESTAMPTZ,
  p_limit INTEGER
)
RETURNS TABLE (tombstone_path TEXT, tombstone_claimed BOOLEAN)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_due TEXT[];
BEGIN
  SELECT pg_catalog.array_agg(locked.path ORDER BY locked.created_at)
    INTO v_due
    FROM (
      SELECT tomb.path, tomb.created_at
        FROM public.blog_media_delete_tombstones AS tomb
       WHERE tomb.created_at < p_cutoff
         AND tomb.path LIKE 'platform/blog/%'
       ORDER BY tomb.created_at
       LIMIT LEAST(GREATEST(p_limit, 0), 1000)
       FOR UPDATE
    ) AS locked;
  IF v_due IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH decoded AS (
    SELECT public.blog_media_percent_decode(post.content) AS content,
           public.blog_media_percent_decode(post.excerpt) AS excerpt,
           public.blog_media_percent_decode(post.featured_image_url)
             AS featured_image_url,
           public.blog_media_percent_decode(post.author_image_url)
             AS author_image_url,
           public.blog_media_percent_decode(
             post.featured_image_variants::text) AS featured_image_variants
      FROM public.blog_posts AS post
  ),
  referenced AS (
    SELECT DISTINCT candidate AS path
      FROM decoded AS post
     CROSS JOIN pg_catalog.unnest(v_due) AS candidate
     WHERE pg_catalog.strpos(post.content, candidate) > 0
        OR pg_catalog.strpos(post.excerpt, candidate) > 0
        OR pg_catalog.strpos(post.featured_image_url, candidate) > 0
        OR pg_catalog.strpos(post.author_image_url, candidate) > 0
        OR pg_catalog.strpos(post.featured_image_variants, candidate) > 0
  ),
  newly_claimed AS (
    UPDATE public.blog_media_delete_tombstones AS tomb
       SET claimed = TRUE
     WHERE tomb.path = ANY(v_due)
       AND tomb.path NOT IN (SELECT path FROM referenced)
     RETURNING tomb.path
  ),
  resurrected AS (
    DELETE FROM public.blog_media_delete_tombstones AS tomb
     WHERE tomb.path = ANY(v_due)
       AND tomb.path IN (SELECT path FROM referenced)
  )
  SELECT due.path, due.path NOT IN (SELECT path FROM referenced)
    FROM pg_catalog.unnest(v_due) AS due(path);
END;
$function$;

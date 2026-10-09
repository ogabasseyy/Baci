-- Prefilter the sweep claim so unscanned posts cost one regex probe
-- instead of a strpos per candidate path. The claim cross-joined
-- every blog post with every due tombstone (up to 500) and ran five
-- full-string scans per pair — hundreds of thousands of scans per
-- sweep as the posts table grows, blowing the cleanup route's
-- duration budget while retries restart on the same oldest rows and
-- starve cleanup. A single escaped alternation over the due paths
-- now probes each decoded post once; only posts that match pay for
-- the exact per-candidate strpos. Match semantics are unchanged —
-- the prefilter only skips posts the exact checks would clear — so
-- prefix-adjacent paths and NULL fields behave exactly as before.
-- Candidates order longest-first for deterministic matching.
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
  candidate_pattern AS (
    SELECT pg_catalog.string_agg(
        pg_catalog.regexp_replace(
          candidate, '([.^$|*+?()\[\]{}\\])', '\\\1', 'g'),
        '|' ORDER BY pg_catalog.length(candidate) DESC, candidate
      ) AS pattern
      FROM pg_catalog.unnest(v_due) AS candidate
  ),
  staged AS (
    SELECT post.*
      FROM decoded AS post
     CROSS JOIN candidate_pattern AS prefilter
     WHERE post.content ~ prefilter.pattern
        OR post.excerpt ~ prefilter.pattern
        OR post.featured_image_url ~ prefilter.pattern
        OR post.author_image_url ~ prefilter.pattern
        OR post.featured_image_variants ~ prefilter.pattern
  ),
  referenced AS (
    SELECT DISTINCT candidate AS path
      FROM staged AS post
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

-- Cap the sweep cutoff inside the worker wrapper. The wrapper
-- passed its p_cutoff argument straight to the inner claim, so any
-- bearer of the worker token could claim with a future cutoff (such
-- as the year 2100) and flag fresh uploads — which stage as
-- unclaimed tombstones immediately — before the one-hour grace
-- window expires, making those objects pass the worker's Storage
-- DELETE policy. The cutoff is now the earlier of the argument and
-- now() minus the sweep grace window (mirroring
-- BLOG_MEDIA_TOMBSTONE_GRACE_MS), so a future cutoff degrades to the
-- standard window while an older, more conservative cutoff still
-- applies. CREATE OR REPLACE preserves the worker-only EXECUTE grant.
CREATE OR REPLACE FUNCTION public.blog_media_sweep_worker_claim(
  p_cutoff TIMESTAMPTZ,
  p_limit INTEGER
)
RETURNS TABLE (tombstone_path TEXT, tombstone_claimed BOOLEAN)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'blog_media_sweep_worker' THEN
    RAISE EXCEPTION 'Blog media sweep worker capability required'
      USING ERRCODE = '42501';
  END IF;
  -- Defense in depth: mirror the sweep constant so a future
  -- relaxation of the inner claim cannot silently widen worker
  -- authority. Reject before touching tombstone rows.
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Blog media sweep claim limit must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT *
    FROM public.claim_sweepable_blog_media_tombstones(
      LEAST(p_cutoff, now() - interval '1 hour'),
      p_limit
    );
END;
$$;

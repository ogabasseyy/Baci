-- Least-privilege PostgREST role for the blog media tombstone
-- cleanup cron. The cron previously constructed the broad
-- event-pipeline service-role client, which the repository's
-- temporary exceptions never authorized for that route. This role's
-- JWT (minted offline with role claim 'blog_media_sweep_worker' and
-- configured as BLOG_MEDIA_SWEEP_WORKER_TOKEN) can invoke only the
-- two sweep wrapper procedures below and delete already-swept byte
-- ranges through the Storage API; every other table, RPC, and bucket
-- path stays denied.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'blog_media_sweep_worker') THEN
    CREATE ROLE blog_media_sweep_worker NOLOGIN NOINHERIT NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE blog_media_sweep_worker NOLOGIN CONNECTION LIMIT -1 PASSWORD NULL;
GRANT USAGE ON SCHEMA public TO blog_media_sweep_worker;
-- No authenticator membership here: granting it would make a
-- provisioned worker JWT usable under the old (or missing)
-- request-scope hook from this commit until the scope migration
-- revokes it. Membership arrives only in 20261009240000, after the
-- hook is installed and the reload probe witnesses it fleet-wide.

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
    FROM public.claim_sweepable_blog_media_tombstones(p_cutoff, p_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.blog_media_sweep_worker_release(
  p_paths TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_released INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'blog_media_sweep_worker' THEN
    RAISE EXCEPTION 'Blog media sweep worker capability required'
      USING ERRCODE = '42501';
  END IF;
  -- Only platform blog paths may ever be released, and only after
  -- the claim flagged them. Reject before deleting.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.unnest(p_paths) AS candidate
     WHERE candidate NOT LIKE 'platform/blog/%'
  ) THEN
    RAISE EXCEPTION 'Blog media sweep release is limited to platform blog paths'
      USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.blog_media_delete_tombstones AS tomb
   WHERE tomb.path = ANY(p_paths)
     AND tomb.claimed IS TRUE;
  GET DIAGNOSTICS v_released = ROW_COUNT;
  RETURN v_released;
END;
$$;

ALTER FUNCTION public.blog_media_sweep_worker_claim(TIMESTAMPTZ, INTEGER)
  OWNER TO postgres;
ALTER FUNCTION public.blog_media_sweep_worker_release(TEXT[])
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.blog_media_sweep_worker_claim(TIMESTAMPTZ, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.blog_media_sweep_worker_release(TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.blog_media_sweep_worker_claim(TIMESTAMPTZ, INTEGER)
  TO blog_media_sweep_worker;
GRANT EXECUTE ON FUNCTION public.blog_media_sweep_worker_release(TEXT[])
  TO blog_media_sweep_worker;

-- Byte removal still goes through the Storage API (direct SQL deletes
-- would orphan file bytes), so the worker role needs a DELETE grant
-- scoped to the platform blog prefix. The sweep only passes claimed
-- paths, and the claim only flags rows the reference scan cleared.
DROP POLICY IF EXISTS "Blog media sweep worker deletes platform media"
  ON storage.objects;
CREATE POLICY "Blog media sweep worker deletes platform media"
  ON storage.objects
  FOR DELETE TO blog_media_sweep_worker
  USING (
    bucket_id = 'media'
    AND name LIKE 'platform/blog/%'
  );

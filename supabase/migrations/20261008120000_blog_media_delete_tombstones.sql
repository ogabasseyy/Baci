-- Staged platform blog media deletions: the DELETE route tombstones
-- paths instead of removing them so a concurrent save can resurrect a
-- tombstone its payload references before the sweep's grace window
-- expires. The scheduled sweep removes only expired tombstones no
-- persisted post references.
CREATE TABLE IF NOT EXISTS public.blog_media_delete_tombstones (
  path TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blog_media_delete_tombstones_created_at_idx
ON public.blog_media_delete_tombstones (created_at);

ALTER TABLE public.blog_media_delete_tombstones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins manage blog media delete tombstones"
ON public.blog_media_delete_tombstones;
CREATE POLICY "Platform admins manage blog media delete tombstones"
ON public.blog_media_delete_tombstones
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.merchants
    WHERE merchants.user_id = auth.uid()
      AND merchants.is_platform_admin IS TRUE
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.merchants
    WHERE merchants.user_id = auth.uid()
      AND merchants.is_platform_admin IS TRUE
  )
);

-- Platform RBAC content managers (mirrors the
-- platform_blog_posts_content_manage_*_v1 bridge): role members pass
-- the route's content.manage check, so the table must authorize them
-- too instead of legacy owners only.
DROP POLICY IF EXISTS
  blog_media_delete_tombstones_content_manage_insert_v1
ON public.blog_media_delete_tombstones;
CREATE POLICY blog_media_delete_tombstones_content_manage_insert_v1
ON public.blog_media_delete_tombstones
FOR INSERT TO authenticated
WITH CHECK (
  public.current_user_has_platform_admin_permission_v1('content.manage')
);

DROP POLICY IF EXISTS
  blog_media_delete_tombstones_content_manage_select_v1
ON public.blog_media_delete_tombstones;
CREATE POLICY blog_media_delete_tombstones_content_manage_select_v1
ON public.blog_media_delete_tombstones
FOR SELECT TO authenticated
USING (
  public.current_user_has_platform_admin_permission_v1('content.manage')
);

DROP POLICY IF EXISTS
  blog_media_delete_tombstones_content_manage_delete_v1
ON public.blog_media_delete_tombstones;
CREATE POLICY blog_media_delete_tombstones_content_manage_delete_v1
ON public.blog_media_delete_tombstones
FOR DELETE TO authenticated
USING (
  public.current_user_has_platform_admin_permission_v1('content.manage')
);

-- Authorize lease refreshes for RBAC content managers. The draft
-- heartbeat PATCHes tombstone created_at forward through PostgREST,
-- but the content.manage policies granted INSERT, SELECT, and DELETE
-- only: for a non-legacy content manager the UPDATE matched zero
-- rows without an error, so the UI believed the lease refreshed while
-- the sweep could still delete media from an active draft. This
-- UPDATE policy mirrors the legacy FOR ALL grant (platform prefix
-- plus the permission) for both USING and WITH CHECK.
DROP POLICY IF EXISTS
  blog_media_delete_tombstones_content_manage_update_v1
ON public.blog_media_delete_tombstones;
CREATE POLICY blog_media_delete_tombstones_content_manage_update_v1
ON public.blog_media_delete_tombstones
FOR UPDATE TO authenticated
USING (
  path LIKE 'platform/blog/%'
  AND public.current_user_has_platform_admin_permission_v1('content.manage')
)
WITH CHECK (
  path LIKE 'platform/blog/%'
  AND public.current_user_has_platform_admin_permission_v1('content.manage')
);

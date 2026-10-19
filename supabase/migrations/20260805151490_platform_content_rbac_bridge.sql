-- Complete the platform-blog RLS bridge for the platform RBAC content role.
-- Merchant-blog policies retain their prior owner/staff behavior; only the
-- platform row and media prefix branches move from the legacy merchant flag.

BEGIN;

DROP POLICY IF EXISTS "Authenticated can delete blog posts" ON public.blog_posts;
DROP POLICY IF EXISTS "Authenticated can insert blog posts" ON public.blog_posts;
DROP POLICY IF EXISTS "Authenticated can update blog posts" ON public.blog_posts;
DROP POLICY IF EXISTS "Platform admins can delete platform blog posts" ON public.blog_posts;
DROP POLICY IF EXISTS "Platform admins can insert platform blog posts" ON public.blog_posts;
DROP POLICY IF EXISTS "Platform admins can update platform blog posts" ON public.blog_posts;

CREATE POLICY blog_posts_merchant_delete_v2 ON public.blog_posts
  FOR DELETE TO authenticated
  USING (
    merchant_id IS NOT NULL
    AND (
      merchant_id IN (
        SELECT merchant.id
        FROM public.merchants AS merchant
        WHERE merchant.user_id = (SELECT auth.uid())
      )
      OR public.check_staff_permission(
        (SELECT auth.uid()), merchant_id, 'marketing', 'delete'
      )
    )
  );

CREATE POLICY blog_posts_merchant_insert_v2 ON public.blog_posts
  FOR INSERT TO authenticated
  WITH CHECK (
    merchant_id IS NOT NULL
    AND (
      merchant_id IN (
        SELECT merchant.id
        FROM public.merchants AS merchant
        WHERE merchant.user_id = (SELECT auth.uid())
      )
      OR public.check_staff_permission(
        (SELECT auth.uid()), merchant_id, 'marketing', 'create'
      )
    )
  );

CREATE POLICY blog_posts_merchant_update_v2 ON public.blog_posts
  FOR UPDATE TO authenticated
  USING (
    merchant_id IS NOT NULL
    AND (
      merchant_id IN (
        SELECT merchant.id
        FROM public.merchants AS merchant
        WHERE merchant.user_id = (SELECT auth.uid())
      )
      OR public.check_staff_permission(
        (SELECT auth.uid()), merchant_id, 'marketing', 'edit'
      )
    )
  ) WITH CHECK (
    merchant_id IS NOT NULL
    AND (
      merchant_id IN (
        SELECT merchant.id
        FROM public.merchants AS merchant
        WHERE merchant.user_id = (SELECT auth.uid())
      )
      OR public.check_staff_permission(
        (SELECT auth.uid()), merchant_id, 'marketing', 'edit'
      )
    )
  );

CREATE POLICY platform_blog_posts_content_manage_insert_v1 ON public.blog_posts
  FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_post IS TRUE
    AND merchant_id IS NULL
    AND public.current_user_has_platform_admin_permission_v1('content.manage')
  );

CREATE POLICY platform_blog_posts_content_manage_update_v1 ON public.blog_posts
  FOR UPDATE TO authenticated
  USING (
    is_platform_post IS TRUE
    AND merchant_id IS NULL
    AND public.current_user_has_platform_admin_permission_v1('content.manage')
  ) WITH CHECK (
    is_platform_post IS TRUE
    AND merchant_id IS NULL
    AND public.current_user_has_platform_admin_permission_v1('content.manage')
  );

CREATE POLICY platform_blog_posts_content_manage_delete_v1 ON public.blog_posts
  FOR DELETE TO authenticated
  USING (
    is_platform_post IS TRUE
    AND merchant_id IS NULL
    AND public.current_user_has_platform_admin_permission_v1('content.manage')
  );

DROP POLICY IF EXISTS "Platform blog posts require published status or admin read"
  ON public.blog_posts;
DROP POLICY IF EXISTS "Anon platform blog posts require published status"
  ON public.blog_posts;

CREATE POLICY platform_blog_posts_authenticated_read_v1 ON public.blog_posts
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    is_platform_post IS NOT TRUE
    OR (
      is_platform_post IS TRUE
      AND merchant_id IS NULL
      AND (
        (status = 'published'::text AND published_at IS NOT NULL)
        OR public.current_user_has_platform_admin_permission_v1('content.manage')
      )
    )
  );

CREATE POLICY platform_blog_posts_anon_read_v1 ON public.blog_posts
  AS RESTRICTIVE FOR SELECT TO anon
  USING (
    is_platform_post IS NOT TRUE
    OR (
      is_platform_post IS TRUE
      AND merchant_id IS NULL
      AND status = 'published'::text
      AND published_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "Platform admins can upload platform blog media"
  ON storage.objects;
DROP POLICY IF EXISTS "Platform admins can update platform blog media"
  ON storage.objects;
DROP POLICY IF EXISTS "Platform admins can delete platform blog media"
  ON storage.objects;

CREATE POLICY platform_blog_media_content_manage_insert_v1 ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND name LIKE 'platform/blog/%'
    AND public.current_user_has_platform_admin_permission_v1('content.manage')
  );

CREATE POLICY platform_blog_media_content_manage_update_v1 ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'media'
    AND name LIKE 'platform/blog/%'
    AND public.current_user_has_platform_admin_permission_v1('content.manage')
  ) WITH CHECK (
    bucket_id = 'media'
    AND name LIKE 'platform/blog/%'
    AND public.current_user_has_platform_admin_permission_v1('content.manage')
  );

CREATE POLICY platform_blog_media_content_manage_delete_v1 ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'media'
    AND name LIKE 'platform/blog/%'
    AND public.current_user_has_platform_admin_permission_v1('content.manage')
  );

COMMIT;

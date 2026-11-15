-- Pilot containment: the legacy permissive SELECT policy remains in place
-- for other tenants. Restrictive policies cannot be bypassed by that grant.
DROP POLICY IF EXISTS ogabassey_blog_anon_public_only ON public.blog_posts;
CREATE POLICY ogabassey_blog_anon_public_only
ON public.blog_posts AS RESTRICTIVE FOR SELECT TO anon
USING (
  merchant_id IS DISTINCT FROM '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
  OR (status = 'published' AND published_at <= now())
);

DROP POLICY IF EXISTS ogabassey_blog_authenticated_public_or_editorial ON public.blog_posts;
CREATE POLICY ogabassey_blog_authenticated_public_or_editorial
ON public.blog_posts AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  merchant_id IS DISTINCT FROM '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
  OR (status = 'published' AND published_at <= now())
  -- Preserve SELECT/RETURNING for staff with existing mutation permissions.
  OR public.check_staff_permission((SELECT auth.uid()), merchant_id, 'marketing', 'view')
  OR public.check_staff_permission((SELECT auth.uid()), merchant_id, 'marketing', 'create')
  OR public.check_staff_permission((SELECT auth.uid()), merchant_id, 'marketing', 'edit')
  OR public.check_staff_permission((SELECT auth.uid()), merchant_id, 'marketing', 'delete')
);

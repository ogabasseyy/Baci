-- Creating a post uses the authorized mutation RPC; it does not require
-- blanket SELECT access to existing unpublished posts.
ALTER POLICY ogabassey_blog_authenticated_public_or_editorial
ON public.blog_posts
USING (
  merchant_id IS DISTINCT FROM '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
  OR (status = 'published' AND published_at <= now())
  OR public.check_staff_permission((SELECT auth.uid()), merchant_id, 'marketing', 'view')
  OR public.check_staff_permission((SELECT auth.uid()), merchant_id, 'marketing', 'edit')
  OR public.check_staff_permission((SELECT auth.uid()), merchant_id, 'marketing', 'delete')
);

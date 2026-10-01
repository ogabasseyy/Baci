-- Prevent a dual-role actor from moving a blog post between merchant and
-- platform ownership scopes. Permissive RLS policies may authorize the OLD
-- row through one role and the NEW row through another, so this OLD/NEW
-- invariant must be enforced at the table boundary.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_blog_post_ownership_scope_invariance_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF OLD.merchant_id IS DISTINCT FROM NEW.merchant_id
    OR (OLD.is_platform_post IS TRUE) IS DISTINCT FROM (NEW.is_platform_post IS TRUE) THEN
    RAISE EXCEPTION 'blog_post_ownership_scope_immutable'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_blog_post_ownership_scope_invariance_v1
  ON public.blog_posts;

CREATE TRIGGER enforce_blog_post_ownership_scope_invariance_v1
  BEFORE UPDATE OF merchant_id, is_platform_post ON public.blog_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_blog_post_ownership_scope_invariance_v1();

COMMIT;

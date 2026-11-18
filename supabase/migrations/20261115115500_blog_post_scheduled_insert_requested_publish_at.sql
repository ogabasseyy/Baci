BEGIN;

CREATE OR REPLACE FUNCTION private.populate_scheduled_blog_post_requested_publish_at_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'scheduled'
     AND NEW.requested_publish_at IS NULL
     AND NEW.published_at IS NOT NULL THEN
    NEW.requested_publish_at := NEW.published_at;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION private.populate_scheduled_blog_post_requested_publish_at_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.populate_scheduled_blog_post_requested_publish_at_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS populate_scheduled_blog_post_requested_publish_at_v1
  ON public.blog_posts;
CREATE TRIGGER populate_scheduled_blog_post_requested_publish_at_v1
  BEFORE INSERT ON public.blog_posts
  FOR EACH ROW
  EXECUTE FUNCTION private.populate_scheduled_blog_post_requested_publish_at_v1();

COMMIT;

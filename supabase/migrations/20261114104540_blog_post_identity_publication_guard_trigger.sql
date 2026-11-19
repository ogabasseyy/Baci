BEGIN;

CREATE OR REPLACE FUNCTION private.guard_blog_post_identity_and_publication_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.article_identity IS NOT NULL
     AND NEW.article_identity IS DISTINCT FROM OLD.article_identity THEN
    RAISE EXCEPTION 'blog_post_article_identity_immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_platform_post IS NOT TRUE
     AND OLD.status = 'published'
     AND NEW.status = 'published' THEN
    NEW.article_identity := COALESCE(OLD.article_identity, NEW.article_identity);
    NEW.published_at := COALESCE(
      OLD.published_at,
      NEW.published_at,
      OLD.requested_publish_at,
      pg_catalog.clock_timestamp()
    );
    NEW.requested_publish_at := OLD.requested_publish_at;
  END IF;

  IF NEW.is_platform_post IS NOT TRUE
     AND OLD.status = 'scheduled'
     AND NEW.status = 'scheduled'
     AND (
       NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.requested_publish_at IS DISTINCT FROM OLD.requested_publish_at
     ) THEN
    IF pg_catalog.current_setting('baci.allow_reservation_post_sync', true) = NEW.id::text THEN
      PERFORM pg_catalog.set_config('baci.allow_reservation_post_sync', '', true);
    ELSIF EXISTS (
      SELECT 1
      FROM private.blog_release_reservations AS r
      WHERE r.merchant_id = OLD.merchant_id
        AND r.post_id = OLD.id
        AND r.state IN ('reserved', 'deferred')
    ) THEN
      RAISE EXCEPTION 'scheduled_reservation_requires_reschedule_rpc'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION private.guard_blog_post_identity_and_publication_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_blog_post_identity_and_publication_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_blog_post_identity_and_publication_v1
  ON public.blog_posts;
CREATE TRIGGER guard_blog_post_identity_and_publication_v1
  BEFORE UPDATE ON public.blog_posts
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_blog_post_identity_and_publication_v1();

COMMIT;

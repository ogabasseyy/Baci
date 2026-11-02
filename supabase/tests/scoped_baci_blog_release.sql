-- Disposable PostgreSQL fixture only. Never run against a deployed database.
\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TABLE public.blog_posts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, slug text UNIQUE,
 content text, excerpt text, featured_image_url text, featured_image_alt text,
 featured_image_width integer, featured_image_height integer,
 featured_image_variants jsonb, category text, tags text[], author_name text,
 seo_title text, seo_description text, focus_keyword text, intent text,
 intent_source text, reading_time_minutes integer, word_count integer,
 merchant_id uuid, is_platform_post boolean, is_ai_generated boolean,
 status text, published_at timestamptz, keywords text[]
);
CREATE FUNCTION private.has_platform_admin_permission_v1(uuid, text)
RETURNS boolean LANGUAGE sql AS $$ SELECT false; $$;
CREATE TABLE public.platform_audit_events (
 actor_user_id uuid, action text, resource_type text, resource_id text,
 changed_fields text[], metadata jsonb
);
\ir ../migrations/20261011192249_scoped_baci_blog_release.sql
\ir ../migrations/20261011192250_approved_baci_blog_release_audit.sql
CREATE TRIGGER audit_platform_blog_post_mutation_v1
AFTER INSERT OR UPDATE OR DELETE ON public.blog_posts
FOR EACH ROW EXECUTE FUNCTION private.audit_platform_blog_post_mutation_v1();
INSERT INTO auth.users VALUES ('11111111-1111-1111-1111-111111111111');
INSERT INTO baci_blog_release_private.publishers VALUES
 ('11111111-1111-1111-1111-111111111111', true);
INSERT INTO baci_blog_release_private.releases
 (id, publisher_id, topic_key, payload, approved_by) VALUES
 ('22222222-2222-2222-2222-222222222222',
 '11111111-1111-1111-1111-111111111111', 'platform:test',
 '{"title":"Approved","slug":"approved","content":"Reviewed content","featured_image_url":"https://example.com/a.webp","featured_image_width":1200,"featured_image_height":675}',
 'test-owner');
DO $$ BEGIN
 IF has_table_privilege('authenticated', 'baci_blog_release_private.releases', 'INSERT')
 OR has_table_privilege('authenticated', 'baci_blog_release_private.releases', 'UPDATE')
 OR has_table_privilege('authenticated', 'baci_blog_release_private.releases', 'SELECT')
 OR has_function_privilege('anon', 'public.publish_approved_baci_blog_release(uuid)', 'EXECUTE')
 THEN RAISE EXCEPTION 'Private approval boundary exposed'; END IF;
 BEGIN
   PERFORM public.publish_approved_baci_blog_release('22222222-2222-2222-2222-222222222222');
   RAISE EXCEPTION 'Unauthenticated publication accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SET ROLE authenticated;
SELECT public.publish_approved_baci_blog_release('22222222-2222-2222-2222-222222222222');
SELECT public.publish_approved_baci_blog_release('22222222-2222-2222-2222-222222222222');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.blog_posts) <> 1
 OR NOT EXISTS (SELECT 1 FROM public.blog_posts WHERE merchant_id IS NULL
   AND is_platform_post AND status = 'published' AND content = 'Reviewed content')
 THEN RAISE EXCEPTION 'Publication or retry contract failed'; END IF;
 IF (SELECT count(*) FROM public.platform_audit_events) <> 1
 OR NOT EXISTS (SELECT 1 FROM public.platform_audit_events
   WHERE actor_user_id = '11111111-1111-1111-1111-111111111111'
     AND action = 'platform_blog_post.created')
 THEN RAISE EXCEPTION 'Publication audit contract failed'; END IF;
 BEGIN
   UPDATE public.blog_posts SET title = 'Unapproved edit';
   RAISE EXCEPTION 'Publisher inherited arbitrary edit permission';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   UPDATE baci_blog_release_private.releases SET payload = '{"title":"Changed"}';
   RAISE EXCEPTION 'Approved payload changed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   UPDATE baci_blog_release_private.releases SET publisher_id = gen_random_uuid();
   RAISE EXCEPTION 'Approved identity changed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
UPDATE baci_blog_release_private.publishers SET enabled = false;
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
   PERFORM public.publish_approved_baci_blog_release('22222222-2222-2222-2222-222222222222');
   RAISE EXCEPTION 'Disabled publisher accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE baci_blog_release_private.publishers SET enabled = true;
SET request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
DO $$ BEGIN
 BEGIN
   PERFORM public.publish_approved_baci_blog_release('22222222-2222-2222-2222-222222222222');
   RAISE EXCEPTION 'Unregistered publisher accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
INSERT INTO auth.users VALUES ('33333333-3333-3333-3333-333333333333');
INSERT INTO baci_blog_release_private.publishers VALUES
 ('33333333-3333-3333-3333-333333333333', true);
DO $$ BEGIN
 BEGIN
   PERFORM public.publish_approved_baci_blog_release('22222222-2222-2222-2222-222222222222');
   RAISE EXCEPTION 'Other publishers release accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS (SELECT 1 FROM public.list_approved_baci_blog_releases()) THEN
   RAISE EXCEPTION 'Other publishers release visible'; END IF;
END $$;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
INSERT INTO baci_blog_release_private.releases
 (id, publisher_id, topic_key, payload, approved_by, expires_at) VALUES
 ('44444444-4444-4444-4444-444444444444',
 '11111111-1111-1111-1111-111111111111', 'platform:expired',
 '{"title":"Expired"}', 'test-owner', now() - interval '1 hour');
DO $$ BEGIN
 BEGIN
   PERFORM public.publish_approved_baci_blog_release('44444444-4444-4444-4444-444444444444');
   RAISE EXCEPTION 'Expired approval accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
UPDATE baci_blog_release_private.releases SET revoked_at = now()
 WHERE id = '22222222-2222-2222-2222-222222222222';
DO $$ BEGIN
 BEGIN
   PERFORM public.publish_approved_baci_blog_release('22222222-2222-2222-2222-222222222222');
   RAISE EXCEPTION 'Revoked release accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- A response-loss recovery must still find an already published release after
-- its approval window expires. It may replay, but cannot create a second post.
INSERT INTO baci_blog_release_private.releases
 (id, publisher_id, topic_key, payload, approved_by, expires_at, post_id, published_at)
 SELECT '55555555-5555-5555-5555-555555555555',
 '11111111-1111-1111-1111-111111111111', 'platform:recovery',
 '{"slug":"approved","title":"Approved"}', 'test-owner', now() - interval '1 hour',
 id, published_at FROM public.blog_posts;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.list_approved_baci_blog_releases()
   WHERE release_id = '55555555-5555-5555-5555-555555555555')
 THEN RAISE EXCEPTION 'Expired published release lost to recovery'; END IF;
 IF NOT (public.publish_approved_baci_blog_release(
   '55555555-5555-5555-5555-555555555555')->>'replayed')::boolean
 THEN RAISE EXCEPTION 'Expired published recovery created a post'; END IF;
END $$;

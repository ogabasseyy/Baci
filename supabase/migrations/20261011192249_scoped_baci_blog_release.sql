-- A publisher can execute approved releases, never author approvals or edit posts.
CREATE SCHEMA IF NOT EXISTS baci_blog_release_private;
REVOKE ALL ON SCHEMA baci_blog_release_private FROM PUBLIC, anon, authenticated;

CREATE TABLE baci_blog_release_private.publishers (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE baci_blog_release_private.releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id uuid NOT NULL REFERENCES baci_blog_release_private.publishers(user_id),
  topic_key text NOT NULL UNIQUE CHECK (topic_key LIKE 'platform:%'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  approved_by text NOT NULL CHECK (length(approved_by) > 0),
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  revoked_at timestamptz,
  post_id uuid REFERENCES public.blog_posts(id) DEFERRABLE INITIALLY DEFERRED,
  published_at timestamptz,
  CHECK ((post_id IS NULL) = (published_at IS NULL))
);
CREATE FUNCTION baci_blog_release_private.hash_release_payload()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.publisher_id IS DISTINCT FROM OLD.publisher_id
    OR NEW.topic_key IS DISTINCT FROM OLD.topic_key
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'Approved payload is immutable' USING ERRCODE = '42501';
  END IF;
  NEW.payload_sha256 := encode(sha256(convert_to(NEW.payload::text, 'UTF8')), 'hex');
  RETURN NEW;
END;
$$;
CREATE TRIGGER hash_release_payload BEFORE INSERT OR UPDATE
ON baci_blog_release_private.releases FOR EACH ROW
EXECUTE FUNCTION baci_blog_release_private.hash_release_payload();
REVOKE ALL ON FUNCTION baci_blog_release_private.hash_release_payload() FROM PUBLIC, anon, authenticated;
CREATE INDEX baci_blog_release_publisher_idx
  ON baci_blog_release_private.releases(publisher_id);
CREATE INDEX baci_blog_release_post_idx ON baci_blog_release_private.releases(post_id);
ALTER TABLE baci_blog_release_private.publishers ENABLE ROW LEVEL SECURITY;
ALTER TABLE baci_blog_release_private.releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA baci_blog_release_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA baci_blog_release_private TO authenticated;

-- SECURITY DEFINER is deliberately limited to immutable operator-approved payloads
-- in the private queue. No caller-supplied content, merchant ID or status is accepted.
CREATE FUNCTION baci_blog_release_private.publish_approved_release(p_release_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  release baci_blog_release_private.releases;
  p jsonb;
  new_post_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM baci_blog_release_private.publishers
    WHERE user_id = auth.uid() AND enabled
  ) THEN RAISE EXCEPTION 'Publisher not authorized' USING ERRCODE = '42501'; END IF;

  SELECT * INTO release FROM baci_blog_release_private.releases
  WHERE id = p_release_id AND publisher_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR release.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Release unavailable' USING ERRCODE = '42501';
  END IF;
  IF release.post_id IS NOT NULL THEN
    RETURN jsonb_build_object('post_id', release.post_id, 'slug', release.payload->>'slug', 'replayed', true);
  END IF;
  IF release.expires_at <= now() THEN
    RAISE EXCEPTION 'Release approval expired' USING ERRCODE = '42501';
  END IF;
  p := release.payload;
  IF coalesce(p->>'title', '') = '' OR coalesce(p->>'content', '') = ''
     OR coalesce(p->>'slug', '') !~ '^[a-z0-9-]+$'
     OR coalesce(p->>'featured_image_url', '') !~ '^https://'
     OR coalesce((p->>'featured_image_width')::integer, 0) < 1200
     OR coalesce((p->>'featured_image_height')::integer, 0) < 675
     OR p ? 'merchant_id' OR p ? 'is_platform_post' THEN
    RAISE EXCEPTION 'Invalid approved payload' USING ERRCODE = '22023';
  END IF;
  new_post_id := gen_random_uuid();
  UPDATE baci_blog_release_private.releases
  SET post_id = new_post_id, published_at = now() WHERE id = release.id;
  INSERT INTO public.blog_posts (
    id, title, slug, content, excerpt, featured_image_url, featured_image_alt,
    featured_image_width, featured_image_height, featured_image_variants,
    category, tags, author_name, seo_title, seo_description, focus_keyword,
    intent, intent_source, reading_time_minutes, word_count,
    merchant_id, is_platform_post, is_ai_generated, status, published_at
  ) VALUES (
    new_post_id, p->>'title', p->>'slug', p->>'content', p->>'excerpt', p->>'featured_image_url', p->>'featured_image_alt',
    (p->>'featured_image_width')::integer, (p->>'featured_image_height')::integer,
    coalesce(p->'featured_image_variants', '{}'::jsonb), p->>'category',
    ARRAY(SELECT jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb))),
    coalesce(p->>'author_name', 'Baci Editorial'), p->>'seo_title', p->>'seo_description', p->>'focus_keyword',
    p->>'intent', p->>'intent_source', (p->>'reading_time_minutes')::integer, (p->>'word_count')::integer,
    NULL, true, true, 'published', now()
  );
  RETURN jsonb_build_object('post_id', new_post_id, 'slug', p->>'slug', 'replayed', false);
END;
$$;
REVOKE ALL ON FUNCTION baci_blog_release_private.publish_approved_release(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION baci_blog_release_private.publish_approved_release(uuid) TO authenticated;

CREATE FUNCTION baci_blog_release_private.list_approved_releases()
RETURNS TABLE(release_id uuid, title text) LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.id, r.payload->>'title'
  FROM baci_blog_release_private.releases r
  JOIN baci_blog_release_private.publishers p ON p.user_id = r.publisher_id
  WHERE p.user_id = auth.uid() AND p.enabled AND r.revoked_at IS NULL
    AND (r.post_id IS NOT NULL OR r.expires_at > now())
  ORDER BY r.approved_at, r.id;
$$;
REVOKE ALL ON FUNCTION baci_blog_release_private.list_approved_releases() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION baci_blog_release_private.list_approved_releases() TO authenticated;

-- Only invoker wrappers live in the exposed schema.
CREATE FUNCTION public.publish_approved_baci_blog_release(p_release_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT baci_blog_release_private.publish_approved_release(p_release_id);
$$;
CREATE FUNCTION public.list_approved_baci_blog_releases()
RETURNS TABLE(release_id uuid, title text) LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT release_id, title FROM baci_blog_release_private.list_approved_releases();
$$;
REVOKE ALL ON FUNCTION public.publish_approved_baci_blog_release(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_approved_baci_blog_releases() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_approved_baci_blog_release(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_approved_baci_blog_releases() TO authenticated;

CREATE FUNCTION private.is_approved_baci_blog_insert_v1(p_post public.blog_posts)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
   SELECT 1 FROM baci_blog_release_private.releases r
   JOIN baci_blog_release_private.publishers p ON p.user_id = r.publisher_id
   WHERE p.user_id = auth.uid() AND p.enabled
     AND r.post_id = p_post.id AND r.published_at = p_post.published_at
     AND r.revoked_at IS NULL AND r.expires_at > now()
     AND p_post.is_platform_post IS TRUE AND p_post.merchant_id IS NULL
     AND p_post.status = 'published'
     AND p_post.slug = r.payload->>'slug'
     AND p_post.title = r.payload->>'title'
     AND p_post.content = r.payload->>'content'
 );
$$;
REVOKE ALL ON FUNCTION private.is_approved_baci_blog_insert_v1(public.blog_posts)
FROM PUBLIC, anon, authenticated;

BEGIN;

-- 5. Private implementations + public SECURITY DEFINER trampolines

-- 5a. adopt_merchant_blog_article_identity_v1
CREATE OR REPLACE FUNCTION private.adopt_merchant_blog_article_identity_v1(
  p_merchant_id uuid,
  p_post_id uuid,
  p_article_identity uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_post public.blog_posts%ROWTYPE;
BEGIN
  PERFORM private.assert_blog_release_actor_v1(p_merchant_id);

  IF p_post_id IS NULL OR p_article_identity IS NULL THEN
    RAISE EXCEPTION 'invalid_article_identity_input' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('blog-release:' || p_merchant_id::text, 0)
  );

  SELECT * INTO v_post
  FROM public.blog_posts AS p
  WHERE p.id = p_post_id
    AND p.merchant_id = p_merchant_id
    AND p.is_platform_post IS NOT TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'blog_post_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_post.article_identity IS NOT NULL THEN
    IF v_post.article_identity = p_article_identity THEN
      RETURN pg_catalog.jsonb_build_object(
        'post_id', v_post.id,
        'merchant_id', v_post.merchant_id,
        'article_identity', v_post.article_identity,
        'post_status', v_post.status,
        'adopted', false,
        'already_adopted', true
      );
    END IF;
    RAISE EXCEPTION 'article_identity_conflict' USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.blog_posts AS other
    WHERE other.merchant_id = p_merchant_id
      AND other.article_identity = p_article_identity
      AND other.id <> p_post_id
  ) THEN
    RAISE EXCEPTION 'article_identity_already_assigned' USING ERRCODE = '23505';
  END IF;

  UPDATE public.blog_posts
  SET article_identity = p_article_identity
  WHERE id = p_post_id
    AND merchant_id = p_merchant_id
    AND article_identity IS NULL
  RETURNING * INTO v_post;

  RETURN pg_catalog.jsonb_build_object(
    'post_id', v_post.id,
    'merchant_id', v_post.merchant_id,
    'article_identity', v_post.article_identity,
    'post_status', v_post.status,
    'adopted', true,
    'already_adopted', false
  );
END;
$$;

ALTER FUNCTION private.adopt_merchant_blog_article_identity_v1(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.adopt_merchant_blog_article_identity_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.adopt_merchant_blog_article_identity_v1(
  p_merchant_id uuid,
  p_post_id uuid,
  p_article_identity uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.adopt_merchant_blog_article_identity_v1(
    p_merchant_id,
    p_post_id,
    p_article_identity
  );
$$;

ALTER FUNCTION public.adopt_merchant_blog_article_identity_v1(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.adopt_merchant_blog_article_identity_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adopt_merchant_blog_article_identity_v1(uuid, uuid, uuid)
  TO authenticated, service_role;

-- 5b. reserve_merchant_blog_release_v1

COMMIT;

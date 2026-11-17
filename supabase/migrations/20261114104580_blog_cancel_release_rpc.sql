BEGIN;

CREATE OR REPLACE FUNCTION private.cancel_merchant_blog_release_v1(
  p_merchant_id uuid,
  p_post_id uuid,
  p_reason text DEFAULT NULL,
  p_reservation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_post public.blog_posts%ROWTYPE;
  v_res private.blog_release_reservations%ROWTYPE;
  v_reason text := NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), '');
BEGIN
  PERFORM private.assert_blog_release_actor_v1(p_merchant_id);

  IF p_post_id IS NULL THEN
    RAISE EXCEPTION 'invalid_cancel_reservation_input' USING ERRCODE = '22023';
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

  IF v_post.status = 'published' THEN
    RAISE EXCEPTION 'cannot_cancel_published_blog_post' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_res
  FROM private.blog_release_reservations AS r
  WHERE r.merchant_id = p_merchant_id
    AND r.post_id = p_post_id
    AND r.state IN ('reserved', 'deferred')
    AND (p_reservation_id IS NULL OR r.id = p_reservation_id)
  ORDER BY r.updated_at DESC, r.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT * INTO v_res
    FROM private.blog_release_reservations AS r
    WHERE r.merchant_id = p_merchant_id
      AND r.post_id = p_post_id
      AND r.state = 'cancelled'
      AND (p_reservation_id IS NULL OR r.id = p_reservation_id)
    ORDER BY r.updated_at DESC, r.created_at DESC
    LIMIT 1;

    IF FOUND AND v_post.status = 'draft' THEN
      RETURN pg_catalog.jsonb_build_object(
        'reservation_id', v_res.id,
        'merchant_id', v_res.merchant_id,
        'post_id', v_res.post_id,
        'article_identity', v_post.article_identity,
        'state', v_res.state,
        'post_status', v_post.status,
        'already_cancelled', true
      );
    END IF;

    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE private.blog_release_reservations
  SET
    state = 'cancelled',
    defer_reason = COALESCE(v_reason, defer_reason),
    next_evaluation_at = NULL,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_res.id
  RETURNING * INTO v_res;

  UPDATE public.blog_posts
  SET
    status = 'draft',
    published_at = NULL,
    requested_publish_at = NULL
  WHERE id = p_post_id
    AND merchant_id = p_merchant_id
  RETURNING * INTO v_post;

  RETURN pg_catalog.jsonb_build_object(
    'reservation_id', v_res.id,
    'merchant_id', v_res.merchant_id,
    'post_id', v_res.post_id,
    'article_identity', v_post.article_identity,
    'state', v_res.state,
    'post_status', v_post.status,
    'already_cancelled', false
  );
END;
$$;

ALTER FUNCTION private.cancel_merchant_blog_release_v1(uuid, uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.cancel_merchant_blog_release_v1(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_merchant_blog_release_v1(
  p_merchant_id uuid,
  p_post_id uuid,
  p_reason text DEFAULT NULL,
  p_reservation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.cancel_merchant_blog_release_v1(
    p_merchant_id,
    p_post_id,
    p_reason,
    p_reservation_id
  );
$$;

ALTER FUNCTION public.cancel_merchant_blog_release_v1(uuid, uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_merchant_blog_release_v1(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_merchant_blog_release_v1(uuid, uuid, text, uuid)
  TO authenticated, service_role;

COMMIT;

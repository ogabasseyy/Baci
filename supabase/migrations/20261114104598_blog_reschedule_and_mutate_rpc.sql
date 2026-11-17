BEGIN;

-- Atomically reschedule a reserved blog post and apply the remaining blog post
-- updates, product links, and media tombstone checks in a single transaction.
-- Any error in either step rolls back the entire transaction.
CREATE OR REPLACE FUNCTION public.reschedule_and_mutate_merchant_blog_post_v1(
  p_post_id uuid,
  p_merchant_id uuid,
  p_new_requested_publish_at timestamptz,
  p_post_data jsonb,
  p_product_ids uuid[] DEFAULT NULL,
  p_media_paths text[] DEFAULT '{}'
)
RETURNS TABLE (
  id uuid,
  merchant_id uuid,
  title text,
  slug text,
  content text,
  excerpt text,
  category text,
  featured_image_url text,
  status text,
  published_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_post_id IS NULL THEN
    RAISE EXCEPTION 'blog_post_id_required' USING ERRCODE = '22023';
  END IF;

  PERFORM public.reschedule_merchant_blog_release_v1(
    p_merchant_id,
    p_post_id,
    p_new_requested_publish_at
  );

  RETURN QUERY
  SELECT *
  FROM public.mutate_merchant_blog_post_with_product_links(
    p_post_id,
    p_merchant_id,
    COALESCE(p_post_data, '{}'::jsonb) - 'published_at',
    p_product_ids,
    p_media_paths
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_and_mutate_merchant_blog_post_v1(
  uuid,
  uuid,
  timestamptz,
  jsonb,
  uuid[],
  text[]
) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.reschedule_and_mutate_merchant_blog_post_v1(
  uuid,
  uuid,
  timestamptz,
  jsonb,
  uuid[],
  text[]
) TO authenticated;

COMMENT ON FUNCTION public.reschedule_and_mutate_merchant_blog_post_v1(
  uuid,
  uuid,
  timestamptz,
  jsonb,
  uuid[],
  text[]
) IS 'Atomically reschedules a reserved merchant blog post and applies remaining post, product-link, and media-path mutations in one transaction.';

COMMIT;

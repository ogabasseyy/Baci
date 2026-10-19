-- Atomically verify merchant blog media inside the mutation.
--
-- A merchant save that references platform media can commit after the
-- sweep's reference scan and before its storage removal, losing its
-- media. Retrying or compensating after commit cannot restore product
-- links or unpublish cleanly, so verification moves inside the same
-- transaction: after the post and links persist, the wrapper
-- registers the saved paths (resurrecting unclaimed tombstones) and
-- raises when any path reports claimed or missing, rolling the whole
-- mutation back. Registration blocks on the sweep's row locks while
-- a claim is in flight, so the probe always sees post-claim truth.
-- The caller supplies the saved paths; the default empty list keeps
-- path-free callers (and the existing atomic-links check) working.

DROP FUNCTION IF EXISTS
  public.mutate_merchant_blog_post_with_product_links(uuid, uuid, jsonb, uuid[]);

CREATE FUNCTION public.mutate_merchant_blog_post_with_product_links(
  p_post_id uuid,
  p_merchant_id uuid,
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
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lost_media_count integer;
  v_owned_product_count integer;
  v_post record;
BEGIN
  -- The base RPC authenticates and authorizes before any mutation. Passing
  -- NULL intentionally preserves links until this wrapper validates and
  -- replaces them atomically below.
  SELECT *
  INTO v_post
  FROM public.mutate_merchant_blog_post_with_product_links_base(
    p_post_id,
    p_merchant_id,
    p_post_data,
    NULL
  );

  IF p_product_ids IS NOT NULL THEN
    IF pg_catalog.cardinality(p_product_ids) > 20 THEN
      RAISE EXCEPTION 'too_many_embedded_product_ids' USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.cardinality(p_product_ids) <> (
      SELECT pg_catalog.count(DISTINCT incoming.product_id)
      FROM pg_catalog.unnest(p_product_ids) AS incoming(product_id)
    ) THEN
      RAISE EXCEPTION 'duplicate_embedded_product_ids' USING ERRCODE = '22023';
    END IF;

    SELECT pg_catalog.count(*)
    INTO v_owned_product_count
    FROM public.products AS product
    WHERE product.merchant_id = p_merchant_id
      AND product.id = ANY(p_product_ids);

    IF v_owned_product_count <> pg_catalog.cardinality(p_product_ids) THEN
      RAISE EXCEPTION 'embedded_product_not_found_or_not_owned'
        USING ERRCODE = 'P0002';
    END IF;

    DELETE FROM public.blog_post_products AS link
    WHERE link.blog_post_id = v_post.id
      AND link.merchant_id = p_merchant_id;

    INSERT INTO public.blog_post_products (
      merchant_id,
      blog_post_id,
      product_id,
      relationship,
      position
    )
    SELECT
      p_merchant_id,
      v_post.id,
      incoming.product_id,
      'primary',
      incoming.position::integer
    FROM pg_catalog.unnest(p_product_ids) WITH ORDINALITY
      AS incoming(product_id, position);
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_lost_media_count
  FROM public.register_blog_media_references_v1(p_media_paths) AS registration
  WHERE registration.status <> 'cleared';

  IF v_lost_media_count > 0 THEN
    RAISE EXCEPTION 'merchant_blog_media_swept_during_save'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    v_post.id,
    v_post.merchant_id,
    v_post.title,
    v_post.slug,
    v_post.content,
    v_post.excerpt,
    v_post.category,
    v_post.featured_image_url,
    v_post.status,
    v_post.published_at;
END;
$$;

REVOKE ALL ON FUNCTION public.mutate_merchant_blog_post_with_product_links(uuid, uuid, jsonb, uuid[], text[])
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.mutate_merchant_blog_post_with_product_links(uuid, uuid, jsonb, uuid[], text[])
  TO authenticated;

COMMENT ON FUNCTION public.mutate_merchant_blog_post_with_product_links(uuid, uuid, jsonb, uuid[], text[]) IS
  'Atomically creates or updates one marketing-authorized merchant blog post, synchronizes its product links in the submitted product ID order, and verifies its saved media paths against the tombstone sweep. Product IDs must belong to the same merchant; null product IDs preserve existing links, while an empty array clears them. Media paths resurrect unclaimed tombstones; any claimed or missing path aborts the whole mutation.';

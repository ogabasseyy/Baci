BEGIN;

-- Preserve original published_at, article_identity, and requested_publish_at on
-- dashboard in-place edits of already-published posts.
CREATE OR REPLACE FUNCTION public.mutate_merchant_blog_post_with_product_links_base(
  p_post_id uuid,
  p_merchant_id uuid,
  p_post_data jsonb,
  p_product_ids uuid[] DEFAULT NULL
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
  v_keywords text[];
  v_owned_product_count integer;
  v_post public.blog_posts%ROWTYPE;
  v_tags text[];
BEGIN
  IF p_merchant_id IS NULL OR p_post_data IS NULL THEN
    RAISE EXCEPTION 'merchant_id_and_post_data_required' USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.jsonb_typeof(p_post_data) <> 'object' THEN
    RAISE EXCEPTION 'post_data_must_be_an_object' USING ERRCODE = '22023';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'merchant_marketing_permission_required' USING ERRCODE = '42501';
  END IF;
  IF p_post_id IS NULL AND public.check_staff_permission(auth.uid(), p_merchant_id, 'marketing', 'create') IS NOT TRUE THEN
    RAISE EXCEPTION 'merchant_marketing_create_permission_required' USING ERRCODE = '42501';
  ELSIF p_post_id IS NOT NULL AND public.check_staff_permission(auth.uid(), p_merchant_id, 'marketing', 'edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'merchant_marketing_edit_permission_required' USING ERRCODE = '42501';
  END IF;

  IF p_post_id IS NULL AND (
    NOT (p_post_data ? 'title')
    OR NOT (p_post_data ? 'slug')
    OR NOT (p_post_data ? 'content')
    OR NOT (p_post_data ? 'author_name')
  ) THEN
    RAISE EXCEPTION 'title_slug_content_and_author_name_required'
      USING ERRCODE = '22023';
  END IF;

  IF p_post_data ? 'tags' THEN
    IF pg_catalog.jsonb_typeof(p_post_data -> 'tags') <> 'array' THEN
      RAISE EXCEPTION 'tags_must_be_an_array' USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.array_agg(tag.value)
    INTO v_tags
    FROM pg_catalog.jsonb_array_elements_text(p_post_data -> 'tags') AS tag(value);
  END IF;

  IF p_post_data ? 'keywords' THEN
    IF pg_catalog.jsonb_typeof(p_post_data -> 'keywords') <> 'array' THEN
      RAISE EXCEPTION 'keywords_must_be_an_array' USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.array_agg(keyword.value)
    INTO v_keywords
    FROM pg_catalog.jsonb_array_elements_text(p_post_data -> 'keywords') AS keyword(value);
  END IF;

  IF p_post_id IS NOT NULL THEN
    SELECT * INTO v_post
    FROM public.blog_posts AS blog_post
    WHERE blog_post.id = p_post_id
      AND blog_post.merchant_id = p_merchant_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'blog_post_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

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
  END IF;

  IF p_post_id IS NULL THEN
    INSERT INTO public.blog_posts AS blog_post (
      merchant_id,
      title,
      slug,
      content,
      excerpt,
      featured_image_url,
      featured_image_width,
      featured_image_height,
      featured_image_variants,
      featured_image_alt,
      category,
      tags,
      keywords,
      author_name,
      author_title,
      author_image_url,
      author_bio,
      status,
      seo_title,
      seo_description,
      focus_keyword,
      word_count,
      reading_time_minutes,
      published_at
    )
    VALUES (
      p_merchant_id,
      p_post_data ->> 'title',
      p_post_data ->> 'slug',
      p_post_data ->> 'content',
      p_post_data ->> 'excerpt',
      p_post_data ->> 'featured_image_url',
      NULLIF(p_post_data ->> 'featured_image_width', '')::integer,
      NULLIF(p_post_data ->> 'featured_image_height', '')::integer,
      COALESCE(p_post_data -> 'featured_image_variants', '{}'::jsonb),
      p_post_data ->> 'featured_image_alt',
      p_post_data ->> 'category',
      COALESCE(v_tags, '{}'::text[]),
      COALESCE(v_keywords, '{}'::text[]),
      p_post_data ->> 'author_name',
      p_post_data ->> 'author_title',
      p_post_data ->> 'author_image_url',
      p_post_data ->> 'author_bio',
      COALESCE(p_post_data ->> 'status', 'draft'),
      p_post_data ->> 'seo_title',
      p_post_data ->> 'seo_description',
      p_post_data ->> 'focus_keyword',
      NULLIF(p_post_data ->> 'word_count', '')::integer,
      NULLIF(p_post_data ->> 'reading_time_minutes', '')::integer,
      NULLIF(p_post_data ->> 'published_at', '')::timestamptz
    )
    RETURNING * INTO v_post;
  ELSE
    UPDATE public.blog_posts AS blog_post
    SET
      title = CASE WHEN p_post_data ? 'title' THEN p_post_data ->> 'title' ELSE blog_post.title END,
      slug = CASE WHEN p_post_data ? 'slug' THEN p_post_data ->> 'slug' ELSE blog_post.slug END,
      content = CASE WHEN p_post_data ? 'content' THEN p_post_data ->> 'content' ELSE blog_post.content END,
      excerpt = CASE WHEN p_post_data ? 'excerpt' THEN p_post_data ->> 'excerpt' ELSE blog_post.excerpt END,
      featured_image_url = CASE WHEN p_post_data ? 'featured_image_url' THEN p_post_data ->> 'featured_image_url' ELSE blog_post.featured_image_url END,
      featured_image_width = CASE WHEN p_post_data ? 'featured_image_width' THEN NULLIF(p_post_data ->> 'featured_image_width', '')::integer ELSE blog_post.featured_image_width END,
      featured_image_height = CASE WHEN p_post_data ? 'featured_image_height' THEN NULLIF(p_post_data ->> 'featured_image_height', '')::integer ELSE blog_post.featured_image_height END,
      featured_image_variants = CASE WHEN p_post_data ? 'featured_image_variants' THEN p_post_data -> 'featured_image_variants' ELSE blog_post.featured_image_variants END,
      featured_image_alt = CASE WHEN p_post_data ? 'featured_image_alt' THEN p_post_data ->> 'featured_image_alt' ELSE blog_post.featured_image_alt END,
      category = CASE WHEN p_post_data ? 'category' THEN p_post_data ->> 'category' ELSE blog_post.category END,
      tags = CASE WHEN p_post_data ? 'tags' THEN COALESCE(v_tags, '{}'::text[])
        ELSE blog_post.tags END,
      keywords = CASE WHEN p_post_data ? 'keywords' THEN COALESCE(v_keywords, '{}'::text[]) ELSE blog_post.keywords END,
      author_name = CASE WHEN p_post_data ? 'author_name' THEN p_post_data ->> 'author_name' ELSE blog_post.author_name END,
      author_title = CASE WHEN p_post_data ? 'author_title' THEN p_post_data ->> 'author_title' ELSE blog_post.author_title END,
      author_image_url = CASE WHEN p_post_data ? 'author_image_url' THEN p_post_data ->> 'author_image_url' ELSE blog_post.author_image_url END,
      author_bio = CASE WHEN p_post_data ? 'author_bio' THEN p_post_data ->> 'author_bio' ELSE blog_post.author_bio END,
      status = CASE WHEN p_post_data ? 'status' THEN p_post_data ->> 'status' ELSE blog_post.status END,
      seo_title = CASE WHEN p_post_data ? 'seo_title' THEN p_post_data ->> 'seo_title' ELSE blog_post.seo_title END,
      seo_description = CASE WHEN p_post_data ? 'seo_description' THEN p_post_data ->> 'seo_description' ELSE blog_post.seo_description END,
      focus_keyword = CASE WHEN p_post_data ? 'focus_keyword' THEN p_post_data ->> 'focus_keyword' ELSE blog_post.focus_keyword END,
      word_count = CASE WHEN p_post_data ? 'word_count' THEN NULLIF(p_post_data ->> 'word_count', '')::integer ELSE blog_post.word_count END,
      reading_time_minutes = CASE WHEN p_post_data ? 'reading_time_minutes' THEN NULLIF(p_post_data ->> 'reading_time_minutes', '')::integer ELSE blog_post.reading_time_minutes END,
      published_at = CASE
        WHEN v_post.status = 'published'
          AND COALESCE(p_post_data ->> 'status', v_post.status) = 'published'
          THEN COALESCE(blog_post.published_at, NULLIF(p_post_data ->> 'published_at', '')::timestamptz, blog_post.requested_publish_at, pg_catalog.clock_timestamp())
        WHEN p_post_data ? 'published_at'
          THEN NULLIF(p_post_data ->> 'published_at', '')::timestamptz
        ELSE blog_post.published_at
      END
    WHERE blog_post.id = p_post_id
      AND blog_post.merchant_id = p_merchant_id
    RETURNING * INTO v_post;
  END IF;

  IF p_product_ids IS NOT NULL THEN
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

REVOKE ALL ON FUNCTION public.mutate_merchant_blog_post_with_product_links_base(
  uuid, uuid, jsonb, uuid[]
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

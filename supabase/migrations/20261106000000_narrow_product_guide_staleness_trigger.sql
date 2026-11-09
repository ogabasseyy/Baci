-- Narrow products_stale_blog_guide_metadata() so updating a product's brand or
-- category_id only marks verified blog guides stale when that product is an
-- explicit subject in public.blog_post_guide_subjects, without invalidating
-- unrelated brand guides across the merchant catalog.

CREATE OR REPLACE FUNCTION public.products_stale_blog_guide_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_old_brand_norm text;
  v_new_brand_norm text;
BEGIN
  IF OLD.brand IS NOT DISTINCT FROM NEW.brand
     AND OLD.category_id IS NOT DISTINCT FROM NEW.category_id THEN
    RETURN NEW;
  END IF;

  v_old_brand_norm := pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.btrim(coalesce(OLD.brand, ''))),
      '[^a-z0-9]+',
      '-',
      'g'
    ),
    '-'
  );
  v_new_brand_norm := pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.btrim(coalesce(NEW.brand, ''))),
      '[^a-z0-9]+',
      '-',
      'g'
    ),
    '-'
  );

  IF OLD.category_id IS NOT DISTINCT FROM NEW.category_id
     AND v_old_brand_norm = v_new_brand_norm THEN
    RETURN NEW;
  END IF;

  UPDATE public.blog_posts AS post
     SET metadata_status = 'stale'
   WHERE post.merchant_id = NEW.merchant_id
     AND post.metadata_status = 'verified'
     AND EXISTS (
       SELECT 1
         FROM public.blog_post_guide_subjects AS subj
        WHERE subj.blog_post_id = post.id
          AND subj.product_id = NEW.id
     );

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.products_stale_blog_guide_metadata() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.products_stale_blog_guide_metadata() FROM PUBLIC;

-- Phase 2A-2D: Metadata-First Article Subjects, Applicability, Staleness Triggers & Candidate Retrieval v2
ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS cluster_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guide_scope text,
  ADD COLUMN IF NOT EXISTS guide_kind text,
  ADD COLUMN IF NOT EXISTS applicable_brands text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS metadata_source text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS metadata_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS metadata_contract_version integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS metadata_source_revision text,
  ADD COLUMN IF NOT EXISTS metadata_content_hash text,
  ADD COLUMN IF NOT EXISTS metadata_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata_verified_by text;
CREATE INDEX IF NOT EXISTS idx_blog_posts_cluster_category_id ON public.blog_posts (cluster_category_id);
ALTER TABLE public.blog_posts DROP CONSTRAINT IF EXISTS blog_posts_guide_scope_check;
ALTER TABLE public.blog_posts ADD CONSTRAINT blog_posts_guide_scope_check
  CHECK (guide_scope IS NULL OR guide_scope IN ('product_specific', 'model_comparison', 'brand_family_guide', 'category_guide', 'troubleshooting', 'general_news')) NOT VALID;
ALTER TABLE public.blog_posts DROP CONSTRAINT IF EXISTS blog_posts_guide_kind_check;
ALTER TABLE public.blog_posts ADD CONSTRAINT blog_posts_guide_kind_check
  CHECK (guide_kind IS NULL OR guide_kind IN ('buyer-guide', 'best-in-nigeria', 'decision-support', 'troubleshooting')) NOT VALID;
ALTER TABLE public.blog_posts DROP CONSTRAINT IF EXISTS blog_posts_metadata_source_check;
ALTER TABLE public.blog_posts ADD CONSTRAINT blog_posts_metadata_source_check
  CHECK (metadata_source IN ('publisher', 'author', 'backfill_verified', 'unverified')) NOT VALID;
ALTER TABLE public.blog_posts DROP CONSTRAINT IF EXISTS blog_posts_metadata_status_check;
ALTER TABLE public.blog_posts ADD CONSTRAINT blog_posts_metadata_status_check
  CHECK (metadata_status IN ('unverified', 'proposed', 'verified', 'stale', 'rejected')) NOT VALID;
ALTER TABLE public.blog_posts DROP CONSTRAINT IF EXISTS blog_posts_guide_scope_kind_matrix_check;
ALTER TABLE public.blog_posts ADD CONSTRAINT blog_posts_guide_scope_kind_matrix_check
  CHECK (
    (guide_scope IS DISTINCT FROM 'general_news' OR guide_kind IS NULL)
    AND (
      guide_scope IS NULL OR guide_kind IS NULL
      OR (guide_scope = 'product_specific' AND guide_kind = 'buyer-guide')
      OR (guide_scope = 'model_comparison' AND guide_kind = 'decision-support')
      OR (guide_scope = 'brand_family_guide' AND guide_kind IN ('buyer-guide', 'best-in-nigeria'))
      OR (guide_scope = 'category_guide' AND guide_kind IN ('buyer-guide', 'best-in-nigeria'))
      OR (guide_scope = 'troubleshooting' AND guide_kind = 'troubleshooting')
    )
    AND (
      metadata_status IS DISTINCT FROM 'verified'
      OR (guide_scope IS NOT NULL AND guide_scope <> 'general_news' AND guide_kind IS NOT NULL AND cluster_category_id IS NOT NULL AND metadata_source_revision IS NOT NULL AND metadata_source_revision <> '')
    )
  ) NOT VALID;

CREATE TABLE IF NOT EXISTS public.blog_post_guide_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  blog_post_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  subject_role text NOT NULL CHECK (subject_role IN ('primary', 'comparison', 'product_support')),
  source_revision text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blog_post_guide_subjects_unique UNIQUE (blog_post_id, product_id, subject_role)
);
CREATE INDEX IF NOT EXISTS idx_blog_post_guide_subjects_merchant_id ON public.blog_post_guide_subjects (merchant_id);
CREATE INDEX IF NOT EXISTS idx_blog_post_guide_subjects_blog_post_id ON public.blog_post_guide_subjects (blog_post_id);
CREATE INDEX IF NOT EXISTS idx_blog_post_guide_subjects_product_id ON public.blog_post_guide_subjects (product_id);

CREATE OR REPLACE FUNCTION public.enforce_blog_post_guide_subjects_merchant_consistency()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.blog_posts WHERE id = NEW.blog_post_id AND merchant_id = NEW.merchant_id) THEN
    RAISE EXCEPTION 'blog_post_id % not owned by merchant %', NEW.blog_post_id, NEW.merchant_id USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = NEW.product_id AND merchant_id = NEW.merchant_id) THEN
    RAISE EXCEPTION 'product_id % not owned by merchant %', NEW.product_id, NEW.merchant_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS blog_post_guide_subjects_merchant_consistency_trigger ON public.blog_post_guide_subjects;
CREATE TRIGGER blog_post_guide_subjects_merchant_consistency_trigger
  BEFORE INSERT OR UPDATE ON public.blog_post_guide_subjects FOR EACH ROW
  EXECUTE FUNCTION public.enforce_blog_post_guide_subjects_merchant_consistency();
ALTER TABLE public.blog_post_guide_subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read published blog guide subjects" ON public.blog_post_guide_subjects;
CREATE POLICY "Public can read published blog guide subjects" ON public.blog_post_guide_subjects FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.blog_posts WHERE blog_posts.id = blog_post_guide_subjects.blog_post_id AND blog_posts.merchant_id = blog_post_guide_subjects.merchant_id AND blog_posts.status = 'published' AND blog_posts.published_at IS NOT NULL AND blog_posts.published_at <= statement_timestamp()));

DROP POLICY IF EXISTS "Merchant staff can manage blog guide subjects" ON public.blog_post_guide_subjects;
CREATE POLICY "Merchant staff can manage blog guide subjects" ON public.blog_post_guide_subjects FOR ALL TO authenticated
  USING (
    merchant_id IS NOT NULL AND (
      merchant_id IN (SELECT m.id FROM public.merchants AS m WHERE m.user_id = (SELECT auth.uid()))
      OR public.check_staff_permission((SELECT auth.uid()), merchant_id, 'marketing', 'edit')
    )
  )
  WITH CHECK (
    merchant_id IS NOT NULL AND (
      merchant_id IN (SELECT m.id FROM public.merchants AS m WHERE m.user_id = (SELECT auth.uid()))
      OR public.check_staff_permission((SELECT auth.uid()), merchant_id, 'marketing', 'edit')
    )
    AND EXISTS (SELECT 1 FROM public.blog_posts WHERE blog_posts.id = blog_post_guide_subjects.blog_post_id AND blog_posts.merchant_id = blog_post_guide_subjects.merchant_id)
    AND EXISTS (SELECT 1 FROM public.products WHERE products.id = blog_post_guide_subjects.product_id AND products.merchant_id = blog_post_guide_subjects.merchant_id)
  );
GRANT SELECT ON public.blog_post_guide_subjects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_post_guide_subjects TO authenticated;
GRANT ALL ON public.blog_post_guide_subjects TO service_role;

CREATE OR REPLACE FUNCTION public.blog_posts_stale_on_content_change_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (SELECT auth.role()) = 'authenticated' AND (NEW.metadata_verified_at IS NOT NULL OR NEW.metadata_verified_by IS NOT NULL OR NEW.metadata_source_revision IS NOT NULL OR NEW.metadata_status = 'verified') THEN RAISE EXCEPTION 'Verification metadata fields are restricted' USING ERRCODE = '42501'; END IF;
    RETURN NEW;
  END IF;
  IF (SELECT auth.role()) = 'authenticated' AND (OLD.metadata_verified_at IS DISTINCT FROM NEW.metadata_verified_at OR OLD.metadata_verified_by IS DISTINCT FROM NEW.metadata_verified_by OR OLD.metadata_source_revision IS DISTINCT FROM NEW.metadata_source_revision OR (OLD.metadata_status IS DISTINCT FROM 'verified' AND NEW.metadata_status = 'verified')) THEN RAISE EXCEPTION 'Verification metadata fields are restricted' USING ERRCODE = '42501'; END IF;
  IF OLD.metadata_status = 'verified' AND NEW.metadata_status = 'verified'
     AND (OLD.title IS DISTINCT FROM NEW.title OR OLD.content IS DISTINCT FROM NEW.content OR OLD.excerpt IS DISTINCT FROM NEW.excerpt OR OLD.category IS DISTINCT FROM NEW.category OR OLD.tags IS DISTINCT FROM NEW.tags OR OLD.keywords IS DISTINCT FROM NEW.keywords OR OLD.cluster_category_id IS DISTINCT FROM NEW.cluster_category_id OR OLD.guide_scope IS DISTINCT FROM NEW.guide_scope OR OLD.guide_kind IS DISTINCT FROM NEW.guide_kind OR OLD.applicable_brands IS DISTINCT FROM NEW.applicable_brands)
     AND OLD.metadata_verified_at IS NOT DISTINCT FROM NEW.metadata_verified_at AND OLD.metadata_source_revision IS NOT DISTINCT FROM NEW.metadata_source_revision
  THEN NEW.metadata_status := 'stale'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS blog_posts_stale_on_content_change ON public.blog_posts;
CREATE TRIGGER blog_posts_stale_on_content_change
  BEFORE INSERT OR UPDATE ON public.blog_posts FOR EACH ROW EXECUTE FUNCTION public.blog_posts_stale_on_content_change_trigger();
CREATE OR REPLACE FUNCTION public.products_stale_blog_guide_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_old_brand_norm text;
  v_new_brand_norm text;
BEGIN
  IF OLD.brand IS NOT DISTINCT FROM NEW.brand AND OLD.category_id IS NOT DISTINCT FROM NEW.category_id THEN RETURN NEW; END IF;
  v_old_brand_norm := pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(coalesce(OLD.brand, ''))), '[^a-z0-9]+', '-', 'g'), '-');
  v_new_brand_norm := pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(coalesce(NEW.brand, ''))), '[^a-z0-9]+', '-', 'g'), '-');
  IF OLD.category_id IS NOT DISTINCT FROM NEW.category_id AND v_old_brand_norm = v_new_brand_norm THEN RETURN NEW; END IF;

  UPDATE public.blog_posts AS post SET metadata_status = 'stale'
  WHERE post.merchant_id = NEW.merchant_id AND post.metadata_status = 'verified'
    AND (
      EXISTS (SELECT 1 FROM public.blog_post_guide_subjects AS subj WHERE subj.blog_post_id = post.id AND subj.product_id = NEW.id)
      OR (
        v_old_brand_norm IS DISTINCT FROM v_new_brand_norm AND (post.cluster_category_id IS NULL OR post.cluster_category_id IS NOT DISTINCT FROM OLD.category_id OR post.cluster_category_id IS NOT DISTINCT FROM NEW.category_id) AND (
          (v_old_brand_norm <> '' AND EXISTS (
            SELECT 1 FROM pg_catalog.unnest(post.applicable_brands) AS b(val)
            WHERE pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(b.val)), '[^a-z0-9]+', '-', 'g'), '-') = v_old_brand_norm
          ))
          OR (v_new_brand_norm <> '' AND EXISTS (
            SELECT 1 FROM pg_catalog.unnest(post.applicable_brands) AS b(val)
            WHERE pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(b.val)), '[^a-z0-9]+', '-', 'g'), '-') = v_new_brand_norm
          ))
        )
      )
    );
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.products_stale_blog_guide_metadata() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.products_stale_blog_guide_metadata() FROM PUBLIC;
DROP TRIGGER IF EXISTS products_stale_blog_guide_metadata_trigger ON public.products;
CREATE TRIGGER products_stale_blog_guide_metadata_trigger
  AFTER UPDATE OF brand, category_id ON public.products FOR EACH ROW EXECUTE FUNCTION public.products_stale_blog_guide_metadata();
CREATE OR REPLACE FUNCTION public.categories_stale_blog_guide_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  UPDATE public.blog_posts SET metadata_status = 'stale' WHERE cluster_category_id = OLD.id AND metadata_status = 'verified';
  RETURN OLD;
END;
$$;
ALTER FUNCTION public.categories_stale_blog_guide_metadata() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.categories_stale_blog_guide_metadata() FROM PUBLIC;
DROP TRIGGER IF EXISTS categories_stale_blog_guide_metadata_trigger ON public.categories;
CREATE TRIGGER categories_stale_blog_guide_metadata_trigger
  BEFORE DELETE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.categories_stale_blog_guide_metadata();

CREATE OR REPLACE FUNCTION public.blog_post_guide_subjects_stale_on_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.blog_posts SET metadata_status = 'stale' WHERE id = OLD.blog_post_id AND merchant_id = OLD.merchant_id AND metadata_status = 'verified';
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    UPDATE public.blog_posts SET metadata_status = 'stale' WHERE id = NEW.blog_post_id AND merchant_id = NEW.merchant_id AND metadata_status = 'verified';
    RETURN NEW;
  END IF;
  IF OLD.blog_post_id IS DISTINCT FROM NEW.blog_post_id OR OLD.product_id IS DISTINCT FROM NEW.product_id OR OLD.subject_role IS DISTINCT FROM NEW.subject_role OR OLD.merchant_id IS DISTINCT FROM NEW.merchant_id OR OLD.source_revision IS DISTINCT FROM NEW.source_revision THEN
    UPDATE public.blog_posts SET metadata_status = 'stale' WHERE metadata_status = 'verified' AND ((id = OLD.blog_post_id AND merchant_id = OLD.merchant_id) OR (id = NEW.blog_post_id AND merchant_id = NEW.merchant_id));
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.blog_post_guide_subjects_stale_on_delete() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.blog_post_guide_subjects_stale_on_delete() FROM PUBLIC;
DROP TRIGGER IF EXISTS blog_post_guide_subjects_stale_on_delete_trigger ON public.blog_post_guide_subjects;
CREATE TRIGGER blog_post_guide_subjects_stale_on_delete_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.blog_post_guide_subjects FOR EACH ROW EXECUTE FUNCTION public.blog_post_guide_subjects_stale_on_delete();
CREATE OR REPLACE FUNCTION public.get_storefront_cluster_guide_candidates_v2(
  p_merchant_id uuid, p_page_kind text, p_category_id uuid DEFAULT NULL, p_product_id uuid DEFAULT NULL, p_limit integer DEFAULT 64
)
RETURNS TABLE (
  id uuid, slug text, title text, excerpt text, category text, tags text[], keywords text[], featured_image_url text,
  published_at timestamp with time zone, reading_time_minutes integer, cluster_category_id uuid, cluster_category_slug text,
  guide_scope text, guide_kind text, applicable_brands text[], eligibility_reason text, metadata_status text, metadata_source_revision text, metadata_contract_version integer, subjects jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' ROWS 64 AS $function$
DECLARE
  v_effective_limit integer;
  v_target_product_id uuid;
  v_target_category_id uuid;
  v_target_brand text;
  v_target_brand_norm text;
  v_category_match_id uuid;
BEGIN
  IF p_merchant_id IS NULL OR p_page_kind IS DISTINCT FROM 'product' OR p_product_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merchant_feature_settings AS s WHERE s.merchant_id = p_merchant_id AND s.blog_enabled IS TRUE) THEN RETURN; END IF;

  SELECT prod.id, prod.category_id, prod.brand INTO v_target_product_id, v_target_category_id, v_target_brand
  FROM public.products AS prod WHERE prod.id = p_product_id AND prod.merchant_id = p_merchant_id AND prod.status = 'active';
  IF v_target_product_id IS NULL THEN RETURN; END IF;

  v_target_brand_norm := pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(coalesce(v_target_brand, ''))), '[^a-z0-9]+', '-', 'g'), '-');

  IF p_category_id IS NOT NULL THEN
    IF p_category_id = v_target_category_id OR EXISTS (SELECT 1 FROM public.product_categories AS pc WHERE pc.product_id = v_target_product_id AND pc.category_id = p_category_id)
    THEN v_category_match_id := p_category_id;
    ELSE v_category_match_id := v_target_category_id; END IF;
  ELSE v_category_match_id := v_target_category_id; END IF;

  v_effective_limit := LEAST(GREATEST(coalesce(p_limit, 64), 1), 64);

  RETURN QUERY
  WITH candidate_matches AS (
    SELECT
      post.id AS post_id, post.slug AS post_slug, post.title AS post_title, post.excerpt AS post_excerpt, post.category AS post_category,
      post.tags AS post_tags, post.keywords AS post_keywords, post.featured_image_url AS post_featured_image_url,
      post.published_at AS post_published_at, post.reading_time_minutes AS post_reading_time_minutes,
      post.cluster_category_id AS post_cluster_category_id, cat.slug AS post_cluster_category_slug,
      post.guide_scope AS post_guide_scope, post.guide_kind AS post_guide_kind, post.applicable_brands AS post_applicable_brands,
      CASE
        WHEN subj.subject_role = 'primary' THEN 'subject_primary'
        WHEN subj.subject_role = 'comparison' THEN 'subject_comparison'
        WHEN subj.subject_role = 'product_support' THEN 'subject_product_support'
        ELSE 'subject_match'
      END AS post_eligibility_reason,
      post.metadata_status AS post_metadata_status, post.metadata_source_revision AS post_metadata_source_revision, post.metadata_contract_version AS post_metadata_contract_version,
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('productId', subj.product_id, 'subjectRole', subj.subject_role, 'sourceRevision', subj.source_revision)) AS post_subjects,
      1 AS match_priority
    FROM public.blog_posts AS post
    INNER JOIN public.blog_post_guide_subjects AS subj
      ON subj.blog_post_id = post.id AND subj.merchant_id = p_merchant_id AND subj.product_id = v_target_product_id
    LEFT JOIN public.categories AS cat ON cat.id = post.cluster_category_id AND cat.merchant_id = p_merchant_id
    WHERE post.merchant_id = p_merchant_id AND post.status = 'published' AND post.published_at IS NOT NULL
      AND post.published_at <= statement_timestamp() AND post.metadata_status = 'verified' AND post.metadata_contract_version >= 2
      AND NOT EXISTS (SELECT 1 FROM public.merchant_blog_classifications AS mc WHERE mc.post_id = post.id AND mc.merchant_id = p_merchant_id AND mc.stale_at IS NULL AND mc.intent = 'news')
      AND (
        (subj.subject_role = 'primary' AND post.guide_scope = 'product_specific' AND post.guide_kind = 'buyer-guide')
        OR (subj.subject_role = 'comparison' AND post.guide_scope = 'model_comparison' AND post.guide_kind = 'decision-support'
          AND (SELECT pg_catalog.count(DISTINCT peer_subj.product_id) FROM public.blog_post_guide_subjects AS peer_subj
               INNER JOIN public.products AS peer_prod ON peer_prod.id = peer_subj.product_id AND peer_prod.merchant_id = p_merchant_id AND peer_prod.status = 'active'
               WHERE peer_subj.blog_post_id = post.id AND peer_subj.merchant_id = p_merchant_id AND peer_subj.subject_role = 'comparison') >= 2)
        OR (subj.subject_role = 'product_support' AND post.guide_scope = 'troubleshooting' AND post.guide_kind = 'troubleshooting')
      )
    UNION ALL
    SELECT
      post.id AS post_id, post.slug AS post_slug, post.title AS post_title, post.excerpt AS post_excerpt, post.category AS post_category,
      post.tags AS post_tags, post.keywords AS post_keywords, post.featured_image_url AS post_featured_image_url,
      post.published_at AS post_published_at, post.reading_time_minutes AS post_reading_time_minutes,
      post.cluster_category_id AS post_cluster_category_id, cat.slug AS post_cluster_category_slug,
      post.guide_scope AS post_guide_scope, post.guide_kind AS post_guide_kind, post.applicable_brands AS post_applicable_brands,
      CASE WHEN post.guide_scope = 'brand_family_guide' THEN 'brand_family_guide' ELSE 'category_guide' END AS post_eligibility_reason,
      post.metadata_status AS post_metadata_status, post.metadata_source_revision AS post_metadata_source_revision, post.metadata_contract_version AS post_metadata_contract_version,
      '[]'::jsonb AS post_subjects,
      CASE WHEN post.guide_scope = 'brand_family_guide' THEN 2 ELSE 3 END AS match_priority
    FROM public.blog_posts AS post
    LEFT JOIN public.categories AS cat ON cat.id = post.cluster_category_id AND cat.merchant_id = p_merchant_id
    WHERE post.merchant_id = p_merchant_id AND post.status = 'published' AND post.published_at IS NOT NULL
      AND post.published_at <= statement_timestamp() AND post.metadata_status = 'verified'
      AND post.metadata_contract_version >= 2 AND NOT EXISTS (SELECT 1 FROM public.merchant_blog_classifications AS mc WHERE mc.post_id = post.id AND mc.merchant_id = p_merchant_id AND mc.stale_at IS NULL AND mc.intent = 'news')
      AND post.guide_kind IN ('buyer-guide', 'best-in-nigeria') AND v_category_match_id IS NOT NULL AND post.cluster_category_id = v_category_match_id
      AND (
        (post.guide_scope = 'brand_family_guide' AND v_target_brand_norm <> '' AND EXISTS (
          SELECT 1 FROM pg_catalog.unnest(post.applicable_brands) AS b(val)
          WHERE pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(b.val)), '[^a-z0-9]+', '-', 'g'), '-') = v_target_brand_norm
        ))
        OR (post.guide_scope = 'category_guide' AND (pg_catalog.cardinality(post.applicable_brands) = 0 OR (v_target_brand_norm <> '' AND EXISTS (
          SELECT 1 FROM pg_catalog.unnest(post.applicable_brands) AS b(val)
          WHERE pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(b.val)), '[^a-z0-9]+', '-', 'g'), '-') = v_target_brand_norm
        ))))
      )
  ),
  deduped_candidates AS (
    SELECT DISTINCT ON (c.post_id)
      c.post_id, c.post_slug, c.post_title, c.post_excerpt, c.post_category, c.post_tags, c.post_keywords, c.post_featured_image_url,
      c.post_published_at, c.post_reading_time_minutes, c.post_cluster_category_id, c.post_cluster_category_slug, c.post_guide_scope,
      c.post_guide_kind, c.post_applicable_brands, c.post_eligibility_reason, c.post_metadata_status, c.post_metadata_source_revision, c.post_metadata_contract_version, c.post_subjects,
      c.match_priority
    FROM candidate_matches AS c ORDER BY c.post_id, c.match_priority ASC, c.post_published_at DESC
  )
  SELECT
    d.post_id, d.post_slug, d.post_title, d.post_excerpt, d.post_category, d.post_tags, d.post_keywords, d.post_featured_image_url,
    d.post_published_at, d.post_reading_time_minutes, d.post_cluster_category_id, d.post_cluster_category_slug, d.post_guide_scope,
    d.post_guide_kind, d.post_applicable_brands, d.post_eligibility_reason, d.post_metadata_status, d.post_metadata_source_revision, d.post_metadata_contract_version, d.post_subjects
  FROM deduped_candidates AS d ORDER BY d.match_priority ASC, d.post_published_at DESC, d.post_id ASC
  LIMIT v_effective_limit;
END;
$function$;
ALTER FUNCTION public.get_storefront_cluster_guide_candidates_v2(uuid, text, uuid, uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_storefront_cluster_guide_candidates_v2(uuid, text, uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_cluster_guide_candidates_v2(uuid, text, uuid, uuid, integer) TO anon, authenticated, service_role;

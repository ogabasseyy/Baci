-- A monotonic merchant revision makes shared comparison cache keys safe across
-- instances. It is separate from cache_invalidation_outbox generations: those
-- are per-target, can be compacted, and are not an ABA-safe merchant clock.

CREATE TABLE IF NOT EXISTS public.storefront_comparison_revisions (
  -- Do not foreign-key this to merchants: the revision must outlive a deleted
  -- outbox row *and* a deleted merchant UUID, preventing ABA if that UUID is
  -- ever restored or reused. The public RPC joins merchants before returning.
  merchant_id uuid PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0)
);

-- `IF NOT EXISTS` is only safe when a previous partial/replayed migration
-- created the exact ledger contract. Refuse to run against an accidental
-- look-alike instead of silently treating a non-monotonic ledger as valid.
DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.storefront_comparison_revisions'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) <> 2 OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.storefront_comparison_revisions'::regclass
      AND attribute.attname = 'merchant_id'
      AND attribute.atttypid = 'uuid'::pg_catalog.regtype
      AND attribute.attnotnull
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.storefront_comparison_revisions'::regclass
      AND attribute.attname = 'revision'
      AND attribute.atttypid = 'int8'::pg_catalog.regtype
      AND attribute.attnotnull
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attrdef AS default_row
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = default_row.adrelid
      AND attribute.attnum = default_row.adnum
    WHERE default_row.adrelid = 'public.storefront_comparison_revisions'::regclass
      AND attribute.attname = 'revision'
      AND pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid) = '1'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.storefront_comparison_revisions'::regclass
      AND constraint_row.contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.storefront_comparison_revisions'::regclass
      AND constraint_row.contype = 'p'
      AND NOT constraint_row.condeferrable
      AND constraint_row.conkey = ARRAY[
        (
          SELECT attribute.attnum
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = 'public.storefront_comparison_revisions'::regclass
            AND attribute.attname = 'merchant_id'
            AND NOT attribute.attisdropped
        )
      ]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.storefront_comparison_revisions'::regclass
      AND constraint_row.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid)
        = 'CHECK ((revision > 0))'
  ) THEN
    RAISE EXCEPTION 'storefront_comparison_revisions has an incompatible ledger schema';
  END IF;
END;
$$;

INSERT INTO public.storefront_comparison_revisions (merchant_id)
SELECT merchant.id
FROM public.merchants AS merchant
ON CONFLICT (merchant_id) DO NOTHING;

ALTER TABLE public.storefront_comparison_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_comparison_revisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.storefront_comparison_revisions
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_published_storefront_comparison_revision(
  p_merchant_id uuid
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT revision.revision
  FROM public.storefront_comparison_revisions AS revision
  INNER JOIN public.merchants AS merchant ON merchant.id = revision.merchant_id
  WHERE revision.merchant_id = p_merchant_id
    AND merchant.is_published IS TRUE
$$;

REVOKE ALL ON FUNCTION public.get_published_storefront_comparison_revision(uuid)
  FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.get_published_storefront_comparison_revision(uuid)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_storefront_cache_targets(
  p_merchant_id uuid,
  p_additional_slug text DEFAULT NULL,
  p_additional_hostname text DEFAULT NULL,
  p_product_slugs text[] DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_slug text;
  v_target text;
  v_slug_targets text[];
  v_hostname_targets text[];
  v_related_identifiers text[];
  v_shared_generation bigint;
BEGIN
  SELECT merchant.slug INTO v_slug
  FROM public.merchants AS merchant
  WHERE merchant.id = p_merchant_id;
  IF v_slug IS NULL THEN
    RETURN;
  END IF;

  SELECT coalesce(pg_catalog.array_agg(candidate ORDER BY candidate), '{}')
  INTO v_slug_targets
  FROM (
    SELECT DISTINCT candidate
    FROM (
      SELECT v_slug AS candidate
      UNION ALL SELECT p_additional_slug
      UNION ALL
      SELECT alias.old_slug
      FROM public.merchant_slug_aliases AS alias
      WHERE alias.merchant_id = p_merchant_id
    ) AS targets
    WHERE candidate IS NOT NULL
  ) AS distinct_slugs;

  SELECT coalesce(pg_catalog.array_agg(candidate ORDER BY candidate), '{}')
  INTO v_hostname_targets
  FROM (
    SELECT DISTINCT candidate
    FROM (
      SELECT domain_row.domain AS candidate
      FROM public.domains AS domain_row
      WHERE domain_row.merchant_id = p_merchant_id
        AND domain_row.status = 'active'
        AND domain_row.verified_at IS NOT NULL
      UNION ALL SELECT p_additional_hostname
    ) AS targets
    WHERE candidate IS NOT NULL
  ) AS distinct_hostnames;

  SELECT coalesce(pg_catalog.array_agg(value ORDER BY value), '{}')
  INTO v_related_identifiers
  FROM (
    SELECT DISTINCT value
    FROM pg_catalog.unnest(
      coalesce(v_slug_targets, '{}') || coalesce(v_hostname_targets, '{}')
    ) AS value
    WHERE value IS NOT NULL
    ORDER BY value
    LIMIT 40
  ) AS related;

  FOREACH v_target IN ARRAY coalesce(v_slug_targets, '{}')
  LOOP
    PERFORM public.enqueue_cache_invalidation_target(
      p_merchant_id,
      'storefront_slug',
      v_target,
      v_related_identifiers,
      p_product_slugs
    );
  END LOOP;

  FOREACH v_target IN ARRAY coalesce(v_hostname_targets, '{}')
  LOOP
    PERFORM public.enqueue_cache_invalidation_target(
      p_merchant_id,
      'storefront_hostname',
      v_target,
      v_related_identifiers,
      p_product_slugs
    );
  END LOOP;

  IF coalesce(pg_catalog.cardinality(v_slug_targets), 0) > 0
    OR coalesce(pg_catalog.cardinality(v_hostname_targets), 0) > 0
  THEN
    SELECT pg_catalog.max(outbox.generation)
    INTO v_shared_generation
    FROM public.cache_invalidation_outbox AS outbox
    WHERE outbox.merchant_id = p_merchant_id
      AND (
        (
          outbox.target_kind = 'storefront_slug'
          AND outbox.target_id = ANY (v_slug_targets)
        )
        OR (
          outbox.target_kind = 'storefront_hostname'
          AND outbox.target_id = ANY (v_hostname_targets)
        )
      );

    UPDATE public.cache_invalidation_outbox AS outbox
    SET generation = v_shared_generation,
        updated_at = pg_catalog.now()
    WHERE outbox.merchant_id = p_merchant_id
      AND v_shared_generation IS NOT NULL
      AND (
        (
          outbox.target_kind = 'storefront_slug'
          AND outbox.target_id = ANY (v_slug_targets)
        )
        OR (
          outbox.target_kind = 'storefront_hostname'
          AND outbox.target_id = ANY (v_hostname_targets)
        )
      )
      AND outbox.generation <> v_shared_generation;
  END IF;

  FOR v_target IN
    SELECT DISTINCT pg_catalog.btrim(candidate)
    FROM pg_catalog.unnest(coalesce(p_product_slugs, '{}')) AS candidate
    WHERE candidate IS NOT NULL
  LOOP
    PERFORM public.enqueue_storefront_product_cache_target(
      p_merchant_id,
      v_target
    );
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_storefront_cache_targets(
  uuid, text, text, text[]
) FROM PUBLIC, anon, authenticated, service_role;

-- Revision changes are deliberately narrower than cache invalidation. The
-- outbox also handles stock-only checkout writes and unrelated storefront
-- data; neither can change the compare inventory/route decision.
CREATE OR REPLACE FUNCTION public.advance_storefront_comparison_revision(
  p_merchant_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_merchant_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.storefront_comparison_revisions AS revision (merchant_id)
  VALUES (p_merchant_id)
  ON CONFLICT (merchant_id) DO UPDATE
  SET revision = revision.revision + 1;
END;
$$;
REVOKE ALL ON FUNCTION public.advance_storefront_comparison_revision(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.advance_storefront_comparison_revision_from_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND ROW(
      OLD.id, OLD.merchant_id, OLD.status, OLD.slug, OLD.name, OLD.brand,
      OLD.price, OLD.category, OLD.category_id, OLD.created_at
    ) IS NOT DISTINCT FROM ROW(
      NEW.id, NEW.merchant_id, NEW.status, NEW.slug, NEW.name, NEW.brand,
      NEW.price, NEW.category, NEW.category_id, NEW.created_at
    )
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT' AND OLD.status = 'active' THEN
    PERFORM public.advance_storefront_comparison_revision(OLD.merchant_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.status = 'active'
    AND (TG_OP = 'INSERT' OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
      OR NEW.status IS DISTINCT FROM OLD.status)
  THEN
    PERFORM public.advance_storefront_comparison_revision(NEW.merchant_id);
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'active' THEN
    -- The old active merchant was already advanced above for same-merchant
    -- updates, so do not rotate the ledger twice.
    NULL;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.advance_storefront_comparison_revision_from_product()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.advance_storefront_comparison_revision_from_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND ROW(OLD.id, OLD.merchant_id, OLD.slug, OLD.name, OLD.is_active, OLD.parent_id)
      IS NOT DISTINCT FROM ROW(
        NEW.id, NEW.merchant_id, NEW.slug, NEW.name, NEW.is_active, NEW.parent_id
      )
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    PERFORM public.advance_storefront_comparison_revision(OLD.merchant_id);
  END IF;
  IF TG_OP <> 'DELETE'
    AND (TG_OP = 'INSERT' OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id)
  THEN
    PERFORM public.advance_storefront_comparison_revision(NEW.merchant_id);
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.advance_storefront_comparison_revision_from_category()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.advance_storefront_comparison_revision_from_product_relation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product_id uuid;
  v_merchant_id uuid;
BEGIN
  FOR v_product_id IN
    SELECT DISTINCT product_id
    FROM (
      VALUES
        (CASE WHEN TG_OP <> 'INSERT' THEN OLD.product_id END),
        (CASE WHEN TG_OP <> 'DELETE' THEN NEW.product_id END)
    ) AS relation(product_id)
    WHERE product_id IS NOT NULL
  LOOP
    SELECT product.merchant_id
    INTO v_merchant_id
    FROM public.products AS product
    WHERE product.id = v_product_id
      AND product.status = 'active';
    IF v_merchant_id IS NOT NULL THEN
      PERFORM public.advance_storefront_comparison_revision(v_merchant_id);
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.advance_storefront_comparison_revision_from_product_relation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.advance_storefront_comparison_revision_from_merchant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.is_published IS DISTINCT FROM NEW.is_published THEN
    PERFORM public.advance_storefront_comparison_revision(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END
    );
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.advance_storefront_comparison_revision_from_merchant()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS products_advance_storefront_comparison_revision
  ON public.products;
CREATE TRIGGER products_advance_storefront_comparison_revision
AFTER INSERT OR DELETE OR UPDATE OF id, merchant_id, status, slug, name, brand,
  price, category, category_id, created_at ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.advance_storefront_comparison_revision_from_product();

DROP TRIGGER IF EXISTS categories_advance_storefront_comparison_revision
  ON public.categories;
CREATE TRIGGER categories_advance_storefront_comparison_revision
AFTER INSERT OR DELETE OR UPDATE OF id, merchant_id, slug, name, is_active, parent_id
ON public.categories FOR EACH ROW
EXECUTE FUNCTION public.advance_storefront_comparison_revision_from_category();

DROP TRIGGER IF EXISTS product_categories_advance_storefront_comparison_revision
  ON public.product_categories;
CREATE TRIGGER product_categories_advance_storefront_comparison_revision
AFTER INSERT OR DELETE OR UPDATE OF product_id, category_id
ON public.product_categories FOR EACH ROW
EXECUTE FUNCTION public.advance_storefront_comparison_revision_from_product_relation();

DROP TRIGGER IF EXISTS product_key_specs_advance_storefront_comparison_revision
  ON public.product_key_specs;
CREATE TRIGGER product_key_specs_advance_storefront_comparison_revision
AFTER INSERT OR UPDATE OR DELETE ON public.product_key_specs
FOR EACH ROW
EXECUTE FUNCTION public.advance_storefront_comparison_revision_from_product_relation();

DROP TRIGGER IF EXISTS merchants_advance_storefront_comparison_revision
  ON public.merchants;
CREATE TRIGGER merchants_advance_storefront_comparison_revision
BEFORE DELETE OR UPDATE OF is_published ON public.merchants
FOR EACH ROW
EXECUTE FUNCTION public.advance_storefront_comparison_revision_from_merchant();

-- Register only enrolled partner feeds. Other merchants' catalog writes do
-- not update this table. The revision is opaque and changes transactionally
-- with the rows that can affect a CrossRem snapshot.
CREATE TABLE public.crossrem_catalog_generations (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
  revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid()
);

ALTER TABLE public.crossrem_catalog_generations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crossrem_catalog_generations FROM PUBLIC, anon, authenticated;
GRANT SELECT (merchant_id, revision) ON public.crossrem_catalog_generations
  TO anon, authenticated;

CREATE POLICY read_published_crossrem_catalog_revision
ON public.crossrem_catalog_generations FOR SELECT TO anon, authenticated
USING (EXISTS (
  SELECT 1 FROM public.merchants m
  WHERE m.id = crossrem_catalog_generations.merchant_id AND m.is_published IS TRUE
));

INSERT INTO public.crossrem_catalog_generations (merchant_id)
SELECT id FROM public.merchants WHERE id = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

CREATE FUNCTION public.bump_crossrem_catalog_generation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  old_id uuid;
  new_id uuid;
  old_category uuid;
  new_category uuid;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    UPDATE public.crossrem_catalog_generations SET revision = pg_catalog.gen_random_uuid();
    RETURN NULL;
  END IF;

  IF TG_ARGV[0] = 'merchant' THEN
    IF TG_OP <> 'INSERT' THEN old_id := OLD.id; END IF;
    IF TG_OP <> 'DELETE' THEN new_id := NEW.id; END IF;
  ELSIF TG_ARGV[0] = 'product' THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT p.merchant_id INTO old_id FROM public.products p WHERE p.id = OLD.product_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT p.merchant_id INTO new_id FROM public.products p WHERE p.id = NEW.product_id;
    END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN old_id := OLD.merchant_id; END IF;
    IF TG_OP <> 'DELETE' THEN new_id := NEW.merchant_id; END IF;
  END IF;

  IF TG_TABLE_NAME = 'product_feed_images' AND TG_OP = 'UPDATE' THEN
    -- A verifier heartbeat alone does not change the published projection.
    IF (OLD.id, OLD.merchant_id, OLD.product_id, OLD.variant_id, OLD.source_url,
        OLD.verified_url, OLD.verified_format, OLD.status, OLD.is_primary, OLD.position)
       IS NOT DISTINCT FROM
       (NEW.id, NEW.merchant_id, NEW.product_id, NEW.variant_id, NEW.source_url,
        NEW.verified_url, NEW.verified_format, NEW.status, NEW.is_primary, NEW.position)
    THEN
      RETURN NULL;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'categories' THEN
    IF TG_OP <> 'INSERT' THEN old_category := OLD.id; END IF;
    IF TG_OP <> 'DELETE' THEN new_category := NEW.id; END IF;

    -- Categories can be used in either of the two product category joins.
    UPDATE public.crossrem_catalog_generations AS g
    SET revision = pg_catalog.gen_random_uuid()
    WHERE g.merchant_id IS DISTINCT FROM old_id
      AND g.merchant_id IS DISTINCT FROM new_id
      AND (
      EXISTS (
        SELECT 1 FROM public.products AS p
        WHERE p.merchant_id = g.merchant_id
          AND p.category_id IN (old_category, new_category)
      )
      OR EXISTS (
        SELECT 1 FROM public.product_categories AS pc
        JOIN public.products AS p ON p.id = pc.product_id
        WHERE p.merchant_id = g.merchant_id
          AND pc.category_id IN (old_category, new_category)
      )
    );
  END IF;

  UPDATE public.crossrem_catalog_generations
  SET revision = pg_catalog.gen_random_uuid()
  WHERE merchant_id IN (old_id, new_id);

  -- Products bump their own merchant when deleted, including when a child
  -- row disappears through a foreign-key cascade.
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_crossrem_catalog_generation() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER zz_crossrem_catalog_generation
AFTER UPDATE OF business_name, country, gmc_variants_enabled, payout_currency,
  slug, logo_url, is_platform_admin, is_published ON public.merchants
FOR EACH ROW EXECUTE FUNCTION public.bump_crossrem_catalog_generation('merchant');

DO $$
DECLARE
  relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY[
    'products', 'product_variants', 'product_offers', 'product_feed_images',
    'categories', 'domains', 'product_categories', 'product_key_specs'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER zz_crossrem_catalog_generation AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_crossrem_catalog_generation(%L)',
      relation,
      CASE WHEN relation IN ('product_categories', 'product_key_specs') THEN 'product' ELSE 'merchant_id' END
    );

    EXECUTE format(
      'CREATE TRIGGER zz_crossrem_catalog_truncate AFTER TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.bump_crossrem_catalog_generation()',
      relation
    );
  END LOOP;
END;
$$;

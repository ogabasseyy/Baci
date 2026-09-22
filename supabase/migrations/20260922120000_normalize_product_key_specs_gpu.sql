-- Category graphics facets expose trimmed `product_key_specs.gpu` values and
-- filter predicates compare trimmed request values, so stored values must be
-- trimmed at rest: a padded row (e.g. ' NVIDIA RTX 4070 ') would otherwise
-- create a facet option that exact-matches nothing, including itself.
--
-- Backfills existing padded values and keeps future writes trimmed with a
-- BEFORE trigger. The whitespace-only UPDATE is safe to replay.

UPDATE public.product_key_specs
SET gpu = btrim(gpu)
WHERE gpu IS NOT NULL AND gpu <> btrim(gpu);

CREATE OR REPLACE FUNCTION public.trim_product_key_specs_gpu()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.gpu IS NOT NULL THEN
    NEW.gpu := btrim(NEW.gpu);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_key_specs_trim_gpu
  ON public.product_key_specs;
CREATE TRIGGER product_key_specs_trim_gpu
BEFORE INSERT OR UPDATE OF gpu
ON public.product_key_specs
FOR EACH ROW
EXECUTE FUNCTION public.trim_product_key_specs_gpu();

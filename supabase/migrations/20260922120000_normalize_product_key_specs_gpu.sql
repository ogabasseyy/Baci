-- Category graphics facets expose trimmed `product_key_specs.gpu` values and
-- filter predicates compare trimmed request values, so stored values must be
-- trimmed at rest: a padded row (e.g. ' NVIDIA RTX 4070 ') would otherwise
-- create a facet option that exact-matches nothing, including itself.
--
-- Trimming covers the full ASCII whitespace set (spaces, tabs, newlines,
-- form-feeds, carriage returns, vertical tabs) via an explicit character
-- class shared with `normalizeCategoryGraphicsValue` in TypeScript, so
-- advertised facet values always exact-match the stored column. Plain
-- `btrim()`/`String.trim()` disagree on tabs and newlines.
--
-- Backfills existing padded values and keeps future writes trimmed with a
-- BEFORE trigger. The whitespace-only UPDATE is safe to replay.

UPDATE public.product_key_specs
SET gpu = regexp_replace(gpu, '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g')
WHERE gpu IS NOT NULL
  AND gpu <> regexp_replace(gpu, '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g');

CREATE OR REPLACE FUNCTION public.trim_product_key_specs_gpu()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.gpu IS NOT NULL THEN
    NEW.gpu := regexp_replace(
      NEW.gpu,
      '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$',
      '',
      'g'
    );
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

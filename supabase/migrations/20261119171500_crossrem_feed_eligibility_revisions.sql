-- Use the public feed resolver as the visibility authority, including
-- enrolled platform-admin storefronts that do not require publication.
ALTER POLICY read_published_crossrem_catalog_revision
ON public.crossrem_catalog_generations
USING (EXISTS (
  SELECT 1
  FROM public.resolve_public_feed_merchant(
    crossrem_catalog_generations.merchant_id::text, false
  )
));

-- Domain visibility changes only when verification becomes present or absent.
-- Rechecks that replace an existing verification timestamp do not affect URLs.
DROP TRIGGER zz_crossrem_catalog_relevant_update ON public.domains;
CREATE TRIGGER zz_crossrem_catalog_relevant_update
AFTER UPDATE ON public.domains
FOR EACH ROW WHEN (
  ROW(OLD.merchant_id, OLD.domain, OLD.status, OLD.is_primary,
      (OLD.verified_at IS NOT NULL)) IS DISTINCT FROM
  ROW(NEW.merchant_id, NEW.domain, NEW.status, NEW.is_primary,
      (NEW.verified_at IS NOT NULL))
)
EXECUTE FUNCTION public.bump_crossrem_catalog_generation('merchant_id');

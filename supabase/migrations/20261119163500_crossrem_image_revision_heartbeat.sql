-- Treat only last_checked_at as a heartbeat. Other current or future manifest
-- columns participate in revision invalidation without a field allowlist.
CREATE FUNCTION public.bump_crossrem_image_update_generation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (pg_catalog.to_jsonb(OLD) - 'last_checked_at') IS DISTINCT FROM
     (pg_catalog.to_jsonb(NEW) - 'last_checked_at') THEN
    UPDATE public.crossrem_catalog_generations
    SET revision = pg_catalog.gen_random_uuid()
    WHERE merchant_id IN (OLD.merchant_id, NEW.merchant_id);
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_crossrem_image_update_generation()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER zz_crossrem_catalog_generation ON public.product_feed_images;

CREATE TRIGGER zz_crossrem_catalog_generation
AFTER INSERT OR DELETE ON public.product_feed_images
FOR EACH ROW EXECUTE FUNCTION public.bump_crossrem_catalog_generation('merchant_id');

CREATE TRIGGER zz_crossrem_image_update_generation
AFTER UPDATE ON public.product_feed_images
FOR EACH ROW EXECUTE FUNCTION public.bump_crossrem_image_update_generation();

-- Retired condition-offer imagery must not leak into base feed rows.
--
-- product_feed_images stores eligible offer images as ordinary
-- product-level rows with no offer ownership (see
-- scripts/lib/feed-offer-image-backfill.ts). When an offer is deactivated,
-- deleted, or swaps images, the product_offers cache-invalidation trigger
-- rebuilds feeds immediately while the retired URLs stay `verified` until
-- the manual backfill reruns -- and the retired offer no longer claims
-- them (collectOfferClaimedImageUrls), so every feed promotes them into
-- the base product row. Stale the orphaned rows synchronously on offer
-- change.
--
-- Conservative by design: a URL survives when the parent product's own
-- images or ANY still-active sibling offer references it, mirroring the
-- backfill source set and the feed status='active' filter, so this trigger
-- can never stale imagery the feeds currently render. Variant-scoped rows
-- belong to the image-generation pipeline and are never touched (mirrors
-- scripts/lib/persist-feed-manifest.ts).

CREATE OR REPLACE FUNCTION public.feed_manifest_image_urls(images jsonb)
RETURNS SETOF text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- Mirror extractImageCandidates / collectOfferClaimedImageUrls exactly:
  -- array-only, string elements or { url } objects with string urls,
  -- trimmed, blanks and malformed elements skipped.
  SELECT DISTINCT trimmed
  FROM (
    SELECT NULLIF(regexp_replace(
      CASE jsonb_typeof(elem.value)
        WHEN 'string' THEN elem.value #>> '{}'
        WHEN 'object' THEN CASE
          WHEN jsonb_typeof(elem.value -> 'url') = 'string'
          THEN elem.value ->> 'url'
          ELSE NULL
        END
        ELSE NULL
      END,
      '^\s+|\s+$', '', 'g'
    ), '') AS trimmed
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(images) = 'array' THEN images
        ELSE '[]'::jsonb
      END
    ) AS elem(value)
  ) AS urls
  WHERE trimmed IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.feed_manifest_image_urls(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.stale_feed_manifest_on_offer_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_product_id uuid := CASE WHEN TG_OP <> 'INSERT' THEN OLD.product_id END;
  v_new_product_id uuid := CASE WHEN TG_OP <> 'DELETE' THEN NEW.product_id END;
  v_old_merchant_id uuid := CASE WHEN TG_OP <> 'INSERT' THEN OLD.merchant_id END;
  v_new_merchant_id uuid := CASE WHEN TG_OP <> 'DELETE' THEN NEW.merchant_id END;
  v_target record;
BEGIN
  -- An offer move between products can orphan URLs on the old product;
  -- recompute both sides like the cache-invalidation trigger.
  FOR v_target IN
    SELECT DISTINCT t.merchant_id, t.product_id
    FROM (
      VALUES
        (v_old_merchant_id, v_old_product_id),
        (v_new_merchant_id, v_new_product_id)
    ) AS t(merchant_id, product_id)
    WHERE t.product_id IS NOT NULL
  LOOP
    UPDATE public.product_feed_images AS manifest
    SET status = 'stale',
      is_primary = false,
      updated_at = now()
    WHERE manifest.merchant_id = v_target.merchant_id
      AND manifest.product_id = v_target.product_id
      AND manifest.variant_id IS NULL
      AND manifest.status <> 'stale'
      AND NOT EXISTS (
        SELECT 1
        FROM public.products AS product
        WHERE product.id = v_target.product_id
          AND manifest.source_url IN (
            SELECT public.feed_manifest_image_urls(product.images)
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.product_offers AS offer
        WHERE offer.merchant_id = v_target.merchant_id
          AND offer.product_id = v_target.product_id
          AND offer.status = 'active'
          AND manifest.source_url IN (
            SELECT public.feed_manifest_image_urls(offer.images)
          )
      );
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.stale_feed_manifest_on_offer_change()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS product_offers_stale_feed_manifest
  ON public.product_offers;
CREATE TRIGGER product_offers_stale_feed_manifest
AFTER UPDATE OR DELETE ON public.product_offers
FOR EACH ROW
EXECUTE FUNCTION public.stale_feed_manifest_on_offer_change();

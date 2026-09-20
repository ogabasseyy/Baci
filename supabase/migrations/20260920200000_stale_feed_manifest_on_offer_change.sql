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
-- Keep-set mirrors the backfill source set exactly: the parent product's
-- own images plus images of ELIGIBLE active sibling offers, using the
-- same predicate as getEligibleConditionOffers (positive price, valid
-- listing condition different from the parent, first per normalized
-- condition by (condition, id)). A status-only predicate would protect
-- imagery the feeds no longer claim. Variant-scoped rows belong to the
-- image-generation pipeline and are never touched (mirrors
-- scripts/lib/persist-feed-manifest.ts).
--
-- Concurrent retirements sharing a product serialize on the parent row:
-- without this, two transactions retiring different siblings can each
-- see the other's pre-image as still active and both skip the stale.
-- Reactivation is intentionally one-way: restored `verified` rows would
-- require re-verification the trigger cannot perform, so reactivated
-- URLs wait for the backfill like any newly added image (fail-closed).

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

CREATE OR REPLACE FUNCTION public.feed_listing_condition(raw_condition text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- Net mapping of normalizeCanonicalProductCondition +
  -- toGoogleListingCondition (packages/shared/src/lib/product-condition.ts):
  -- trim, lowercase, whitespace/dash runs to underscores, uk_used folds to
  -- used, refurbished folds through open_box back to refurbished.
  SELECT CASE lower(regexp_replace(
      regexp_replace(COALESCE(raw_condition, ''), '^\s+|\s+$', '', 'g'),
      '[\s-]+', '_', 'g'
    ))
    WHEN 'new' THEN 'new'
    WHEN 'used' THEN 'used'
    WHEN 'uk_used' THEN 'used'
    WHEN 'open_box' THEN 'refurbished'
    WHEN 'refurbished' THEN 'refurbished'
    ELSE NULL
  END
$$;

REVOKE ALL ON FUNCTION public.feed_listing_condition(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.stale_orphaned_feed_manifest_rows(
  p_merchant_id uuid,
  p_product_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_product_id IS NOT NULL THEN
    PERFORM 1 FROM public.products WHERE id = p_product_id FOR UPDATE;
  END IF;

  UPDATE public.product_feed_images AS manifest
  SET status = 'stale',
    is_primary = false,
    updated_at = now()
  WHERE (p_merchant_id IS NULL OR manifest.merchant_id = p_merchant_id)
    AND (p_product_id IS NULL OR manifest.product_id = p_product_id)
    AND manifest.variant_id IS NULL
    AND manifest.status <> 'stale'
    AND NOT EXISTS (
      SELECT 1
      FROM public.products AS product
      WHERE product.id = manifest.product_id
        AND manifest.source_url IN (
          SELECT public.feed_manifest_image_urls(product.images)
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (
        SELECT ranked.images
        FROM (
          SELECT
            o.images,
            ROW_NUMBER() OVER (
              PARTITION BY public.feed_listing_condition(o.condition)
              ORDER BY o.condition, o.id
            ) AS rn
          FROM public.product_offers AS o
          JOIN public.products AS parent ON parent.id = o.product_id
          WHERE o.merchant_id = manifest.merchant_id
            AND o.product_id = manifest.product_id
            AND o.status = 'active'
            AND o.price > 0
            AND public.feed_listing_condition(o.condition) IS NOT NULL
            AND (
              -- A null parent defaults to new, matching the storefront PDP
              -- rule; a non-null but unmappable parent excludes nothing.
              (
                parent.condition IS NOT NULL
                AND public.feed_listing_condition(parent.condition) IS NULL
              )
              OR public.feed_listing_condition(o.condition)
                <> COALESCE(public.feed_listing_condition(parent.condition), 'new')
            )
        ) AS ranked
        WHERE ranked.rn = 1
      ) AS eligible
      WHERE manifest.source_url IN (
        SELECT public.feed_manifest_image_urls(eligible.images)
      )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.stale_orphaned_feed_manifest_rows(uuid, uuid)
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
  -- recompute both sides like the cache-invalidation trigger, locking in
  -- deterministic product order.
  FOR v_target IN
    SELECT DISTINCT t.merchant_id, t.product_id
    FROM (
      VALUES
        (v_old_merchant_id, v_old_product_id),
        (v_new_merchant_id, v_new_product_id)
    ) AS t(merchant_id, product_id)
    WHERE t.product_id IS NOT NULL
    ORDER BY t.product_id
  LOOP
    PERFORM public.stale_orphaned_feed_manifest_rows(
      v_target.merchant_id,
      v_target.product_id
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

-- One-time repair for rows orphaned before this trigger existed. Deleted
-- offers leave no future event, so without this the fix would apply only
-- to subsequent changes; the trigger keeps the table converged after.
SELECT public.stale_orphaned_feed_manifest_rows(NULL, NULL);

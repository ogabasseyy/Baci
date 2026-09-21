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
-- change. Inserts recompute too: a new offer can dethrone the
-- normalized-condition winner with no update or delete event.
--
-- Keep-set mirrors the backfill source set exactly: the parent product's
-- own images plus images of ELIGIBLE active sibling offers, using the
-- same predicate as getEligibleConditionOffers (flagged non-matrix
-- parent, positive price, valid listing condition different from the
-- parent, first per normalized condition by (condition, id)). A
-- status-only predicate would protect imagery the feeds no longer claim.
-- Matches consider verified_url as well as source_url, mirroring
-- resolveOfferFeedImages, so an offer swapped onto its own derivative
-- keeps rendering. Variant-scoped rows belong to the image-generation
-- pipeline and are never touched (mirrors
-- scripts/lib/persist-feed-manifest.ts).
--
-- Statement-level triggers collect every affected product once and lock
-- in deterministic product order: row-level locking can deadlock when a
-- multi-row statement touches products in opposite orders, and FOR UPDATE
-- upgrades conflict with the preexisting foreign-key locks on moved
-- offers, so recomputation serializes on a transaction-scoped advisory
-- lock per product instead. The one-time repair enqueues every
-- affected merchant so served feed entries are evicted behind it. A
-- parent product update recomputes too,
-- filtered to condition, variant_model, and flag changes, since
-- eligibility can change with no offer event at all. Reactivation is intentionally one-way: restored
-- `verified` rows would require re-verification the trigger cannot
-- perform, so reactivated URLs wait for the backfill like any newly
-- added image (fail-closed).

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
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH staled AS (
    UPDATE public.product_feed_images AS manifest
  SET status = 'stale',
    is_primary = false,
    updated_at = now()
  WHERE (p_merchant_id IS NULL OR manifest.merchant_id = p_merchant_id)
    AND (p_product_id IS NULL OR manifest.product_id = p_product_id)
    AND manifest.variant_id IS NULL
    AND manifest.status <> 'stale'
    AND NOT EXISTS (
      WITH claims(url) AS (
        SELECT public.feed_manifest_image_urls(product.images)
        FROM public.products AS product
        WHERE product.id = manifest.product_id
        UNION ALL
        SELECT public.feed_manifest_image_urls(eligible.images)
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
              -- Numeric NaN sorts above every finite value, unlike
              -- Number.isFinite on the feed side: exclude it explicitly.
              AND o.price <> 'NaN'::numeric
              AND parent.has_condition_offers IS TRUE
              AND parent.variant_model IS DISTINCT FROM 'sku_matrix'
              AND public.feed_listing_condition(o.condition) IS NOT NULL
              AND (
                -- A null parent defaults to new, matching the storefront
                -- PDP rule; a non-null but unmappable parent excludes
                -- nothing.
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
      )
      SELECT 1
      FROM claims
      WHERE claims.url = manifest.source_url
        OR claims.url = manifest.verified_url
    )
    RETURNING manifest.merchant_id
  )
  SELECT DISTINCT staled.merchant_id FROM staled;
END;
$$;

REVOKE ALL ON FUNCTION public.stale_orphaned_feed_manifest_rows(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lock_feed_manifest_product(
  p_product_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Transaction-scoped, pooler-safe, and disjoint from every row lock, so
  -- concurrent recomputes serialize without lock-upgrade cycles.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    hashtextextended(concat('feed-manifest:', p_product_id::text), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lock_feed_manifest_product(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.stale_feed_manifest_on_offer_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target record;
BEGIN
  -- An offer move between products can orphan URLs on the old product;
  -- recompute both sides. One ordered pass per statement keeps
  -- multi-row updates deadlock-free.
  FOR v_target IN
    SELECT DISTINCT t.merchant_id, t.product_id
    FROM (
      SELECT old_offers.merchant_id, old_offers.product_id FROM old_offers
      UNION ALL
      SELECT new_offers.merchant_id, new_offers.product_id FROM new_offers
    ) AS t(merchant_id, product_id)
    ORDER BY t.product_id
  LOOP
    PERFORM public.lock_feed_manifest_product(v_target.product_id);
    PERFORM public.stale_orphaned_feed_manifest_rows(
      v_target.merchant_id,
      v_target.product_id
    );
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.stale_feed_manifest_on_offer_update()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.stale_feed_manifest_on_offer_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target record;
BEGIN
  -- An insert can dethrone the normalized-condition winner (open_box
  -- sorts before refurbished), orphaning the former winner's image with
  -- no update or delete event.
  FOR v_target IN
    SELECT DISTINCT new_offers.merchant_id, new_offers.product_id
    FROM new_offers
    ORDER BY new_offers.product_id
  LOOP
    PERFORM public.lock_feed_manifest_product(v_target.product_id);
    PERFORM public.stale_orphaned_feed_manifest_rows(
      v_target.merchant_id,
      v_target.product_id
    );
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.stale_feed_manifest_on_offer_insert()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.stale_feed_manifest_on_offer_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target record;
BEGIN
  FOR v_target IN
    SELECT DISTINCT old_offers.merchant_id, old_offers.product_id
    FROM old_offers
    ORDER BY old_offers.product_id
  LOOP
    PERFORM public.lock_feed_manifest_product(v_target.product_id);
    PERFORM public.stale_orphaned_feed_manifest_rows(
      v_target.merchant_id,
      v_target.product_id
    );
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.stale_feed_manifest_on_offer_delete()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.stale_feed_manifest_on_product_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target record;
BEGIN
  -- Eligibility can change with no offer event (condition, matrix, or
  -- flag flip), so parent updates recompute the same keep-set.
  -- Transition tables cannot combine with an UPDATE OF column list, so
  -- the trigger fires on every parent update and filters to relevant
  -- column changes here.
  FOR v_target IN
    SELECT DISTINCT new_products.merchant_id, new_products.id AS product_id
    FROM new_products
    JOIN old_products ON old_products.id = new_products.id
    WHERE new_products.condition IS DISTINCT FROM old_products.condition
      OR new_products.variant_model IS DISTINCT FROM old_products.variant_model
      OR new_products.has_condition_offers
        IS DISTINCT FROM old_products.has_condition_offers
    ORDER BY new_products.id
  LOOP
    PERFORM public.lock_feed_manifest_product(v_target.product_id);
    PERFORM public.stale_orphaned_feed_manifest_rows(
      v_target.merchant_id,
      v_target.product_id
    );
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.stale_feed_manifest_on_product_update()
  FROM PUBLIC, anon, authenticated, service_role;

-- Superseded row-level flow from the unmerged revision; never deployed.
DROP TRIGGER IF EXISTS product_offers_stale_feed_manifest
  ON public.product_offers;
DROP FUNCTION IF EXISTS public.stale_feed_manifest_on_offer_change();

DROP TRIGGER IF EXISTS product_offers_stale_feed_manifest_update
  ON public.product_offers;
CREATE TRIGGER product_offers_stale_feed_manifest_update
AFTER UPDATE ON public.product_offers
REFERENCING OLD TABLE AS old_offers NEW TABLE AS new_offers
FOR EACH STATEMENT
EXECUTE FUNCTION public.stale_feed_manifest_on_offer_update();

DROP TRIGGER IF EXISTS product_offers_stale_feed_manifest_insert
  ON public.product_offers;
CREATE TRIGGER product_offers_stale_feed_manifest_insert
AFTER INSERT ON public.product_offers
REFERENCING NEW TABLE AS new_offers
FOR EACH STATEMENT
EXECUTE FUNCTION public.stale_feed_manifest_on_offer_insert();

DROP TRIGGER IF EXISTS product_offers_stale_feed_manifest_delete
  ON public.product_offers;
CREATE TRIGGER product_offers_stale_feed_manifest_delete
AFTER DELETE ON public.product_offers
REFERENCING OLD TABLE AS old_offers
FOR EACH STATEMENT
EXECUTE FUNCTION public.stale_feed_manifest_on_offer_delete();

DROP TRIGGER IF EXISTS products_stale_feed_manifest
  ON public.products;
CREATE TRIGGER products_stale_feed_manifest
AFTER UPDATE ON public.products
REFERENCING OLD TABLE AS old_products NEW TABLE AS new_products
FOR EACH STATEMENT
EXECUTE FUNCTION public.stale_feed_manifest_on_product_update();

CREATE OR REPLACE FUNCTION public.repair_orphaned_feed_manifest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_id uuid;
BEGIN
  -- The repair writes no product or offer row, so no existing trigger
  -- fires: enqueue every affected merchant so the drainer evicts the
  -- already-served feed entries (merchant-feed tags) behind the repair.
  FOR v_merchant_id IN
    SELECT public.stale_orphaned_feed_manifest_rows(NULL, NULL)
  LOOP
    PERFORM public.enqueue_storefront_cache_targets(v_merchant_id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_orphaned_feed_manifest()
  FROM PUBLIC, anon, authenticated, service_role;

-- One-time repair for rows orphaned before this trigger existed. Deleted
-- offers leave no future event, so without this the fix would apply only
-- to subsequent changes; the triggers keep the table converged after.
SELECT public.repair_orphaned_feed_manifest();

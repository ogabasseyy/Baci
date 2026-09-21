-- Retired offer imagery must stale synchronously on offer change.
-- product_feed_images rows carry no offer ownership, so without the
-- product_offers_stale_feed_manifest trigger a deactivated offer (or a
-- swapped image) leaves verified rows that every feed promotes into the
-- base product row until the manual backfill reruns.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '84000000-0000-4000-8000-000000000001';
  v_merchant_two uuid := '84000000-0000-4000-8000-000000000002';
  v_product uuid := '84100000-0000-4000-8000-000000000001';
  v_product_two uuid := '84100000-0000-4000-8000-000000000002';
  v_product_other_merchant uuid := '84100000-0000-4000-8000-000000000003';
  v_product_swap uuid := '84100000-0000-4000-8000-000000000004';
  v_product_shared uuid := '84100000-0000-4000-8000-000000000005';
  v_product_parent uuid := '84100000-0000-4000-8000-000000000006';
  v_product_derivative uuid := '84100000-0000-4000-8000-000000000007';
  v_product_unflagged uuid := '84100000-0000-4000-8000-000000000008';
  v_product_dethrone uuid := '84100000-0000-4000-8000-000000000009';
  v_variant uuid := '84200000-0000-4000-8000-000000000001';
  v_offer_retire uuid := '84300000-0000-4000-8000-000000000001';
  v_offer_keeper uuid := '84300000-0000-4000-8000-000000000002';
  v_offer_shared_a uuid := '84300000-0000-4000-8000-000000000003';
  v_offer_shared_b uuid := '84300000-0000-4000-8000-000000000004';
  v_offer_overlap uuid := '84300000-0000-4000-8000-000000000005';
  v_offer_shapes uuid := '84300000-0000-4000-8000-000000000006';
  v_offer_zero_price uuid := '84300000-0000-4000-8000-000000000007';
  v_offer_same_condition uuid := '84300000-0000-4000-8000-000000000008';
  v_offer_swapper uuid := '84300000-0000-4000-8000-000000000009';
  v_offer_dedup_winner uuid := '84300000-0000-4000-8000-00000000000a';
  v_offer_dedup_loser uuid := '84300000-0000-4000-8000-00000000000b';
  v_offer_morph uuid := '84300000-0000-4000-8000-00000000000c';
  v_offer_avifswap uuid := '84300000-0000-4000-8000-00000000000d';
  v_offer_flagoff uuid := '84300000-0000-4000-8000-00000000000e';
  v_offer_incumbent uuid := '84300000-0000-4000-8000-00000000000f';
  v_offer_challenger uuid := '84300000-0000-4000-8000-000000000010';
  v_offer_nan_price uuid := '84300000-0000-4000-8000-000000000011';
  v_status text;
  v_is_primary boolean;
  v_count integer;
  v_generation bigint;
  v_next_generation bigint;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES
    (v_merchant, 'offer-manifest@example.com', 'Offer Manifest', 'offer-manifest'),
    (v_merchant_two, 'offer-manifest-two@example.com', 'Offer Manifest Two', 'offer-manifest-two');
  INSERT INTO public.products (id, merchant_id, name, price, slug, status, condition, has_condition_offers, images)
  VALUES
    (v_product, v_merchant, 'Offer Phone', 100, 'offer-phone', 'active', NULL, true,
      '["https://cdn.example.com/base.jpg"]'),
    (v_product_two, v_merchant, 'Offer Phone Two', 120, 'offer-phone-two', 'active', 'new', true,
      '["https://cdn.example.com/overlap-base.jpg"]'),
    (v_product_other_merchant, v_merchant_two, 'Offer Phone Other', 130, 'offer-phone-other', 'active', NULL, false, '[]'),
    (v_product_swap, v_merchant, 'Offer Phone Swap', 140, 'offer-phone-swap', 'active', NULL, true, '[]'),
    (v_product_shared, v_merchant, 'Offer Phone Shared', 150, 'offer-phone-shared', 'active', NULL, true, '[]'),
    (v_product_parent, v_merchant, 'Offer Phone Parent', 160, 'offer-phone-parent', 'active', NULL, true, '[]'),
    (v_product_derivative, v_merchant, 'Offer Phone Derivative', 170, 'offer-phone-derivative', 'active', NULL, true, '[]'),
    (v_product_unflagged, v_merchant, 'Offer Phone Unflagged', 180, 'offer-phone-unflagged', 'active', NULL, false, '[]'),
    (v_product_dethrone, v_merchant, 'Offer Phone Dethrone', 190, 'offer-phone-dethrone', 'active', NULL, true, '[]');
  -- One offer per (product, condition): the unique offer key forbids more.
  INSERT INTO public.product_offers (id, product_id, merchant_id, condition, price, status, images)
  VALUES
    (v_offer_retire, v_product, v_merchant, 'used', 50, 'active',
      '["https://cdn.example.com/retired.jpg", "https://cdn.example.com/variant-offer.jpg"]'),
    (v_offer_keeper, v_product, v_merchant, 'open_box', 70, 'active',
      '["https://cdn.example.com/keep.jpg"]'),
    (v_offer_shared_a, v_product_shared, v_merchant, 'used', 70, 'active',
      '["https://cdn.example.com/shared.jpg"]'),
    (v_offer_shared_b, v_product_shared, v_merchant, 'open_box', 80, 'active',
      '["https://cdn.example.com/shared.jpg"]'),
    (v_offer_overlap, v_product_two, v_merchant, 'used', 55, 'active',
      '["https://cdn.example.com/overlap-base.jpg"]'),
    (v_offer_shapes, v_product_two, v_merchant, 'refurbished', 65, 'active',
      '["  https://cdn.example.com/shaped.jpg  ", 123, {"url": 456}, "   ", {"url": "https://cdn.example.com/obj.jpg"}, null]'),
    (v_offer_zero_price, v_product_two, v_merchant, 'open_box', 0, 'active',
      '["https://cdn.example.com/zeroprice.jpg"]'),
    (v_offer_same_condition, v_product_two, v_merchant, 'new', 90, 'active',
      '["https://cdn.example.com/samecond.jpg"]'),
    (v_offer_swapper, v_product_swap, v_merchant, 'used', 60, 'active',
      '["https://cdn.example.com/swap-old.jpg"]'),
    -- open_box sorts before refurbished, so the winner keeps the shared
    -- normalized refurbished condition and the loser is ineligible.
    (v_offer_dedup_winner, v_product_swap, v_merchant, 'open_box', 70, 'active',
      '["https://cdn.example.com/win.jpg"]'),
    (v_offer_dedup_loser, v_product_swap, v_merchant, 'refurbished', 75, 'active',
      '["https://cdn.example.com/lose.jpg"]'),
    (v_offer_morph, v_product_parent, v_merchant, 'used', 60, 'active',
      '["https://cdn.example.com/morph.jpg"]'),
    (v_offer_avifswap, v_product_derivative, v_merchant, 'used', 60, 'active',
      '["https://cdn.example.com/photo.avif"]'),
    (v_offer_flagoff, v_product_unflagged, v_merchant, 'used', 60, 'active',
      '["https://cdn.example.com/flagoff.jpg"]'),
    (v_offer_incumbent, v_product_dethrone, v_merchant, 'refurbished', 60, 'active',
      '["https://cdn.example.com/ref9img.jpg"]'),
    (v_offer_nan_price, v_product_dethrone, v_merchant, 'used', 'NaN', 'active',
      '["https://cdn.example.com/nan9img.jpg"]');
  -- Single primary per (merchant, product, variant bucket); unique
  -- (merchant, product, source_url) across variant scopes.
  INSERT INTO public.product_feed_images
    (merchant_id, product_id, variant_id, source_url, verified_url, verified_format, status, is_primary, position)
  VALUES
    (v_merchant, v_product, NULL, 'https://cdn.example.com/base.jpg', 'https://cdn.example.com/base.jpg', 'jpeg', 'verified', false, 0),
    (v_merchant, v_product, NULL, 'https://cdn.example.com/retired.jpg', 'https://cdn.example.com/retired.jpg', 'jpeg', 'verified', true, 1),
    (v_merchant, v_product, NULL, 'https://cdn.example.com/keep.jpg', 'https://cdn.example.com/keep.jpg', 'jpeg', 'verified', false, 2),
    (v_merchant, v_product, v_variant, 'https://cdn.example.com/variant-offer.jpg', 'https://cdn.example.com/variant-offer.jpg', 'jpeg', 'verified', false, 0),
    (v_merchant, v_product_shared, NULL, 'https://cdn.example.com/shared.jpg', 'https://cdn.example.com/shared.jpg', 'jpeg', 'verified', false, 0),
    (v_merchant, v_product_two, NULL, 'https://cdn.example.com/overlap-base.jpg', 'https://cdn.example.com/overlap-base.jpg', 'jpeg', 'verified', true, 0),
    (v_merchant, v_product_two, NULL, 'https://cdn.example.com/shaped.jpg', 'https://cdn.example.com/shaped.jpg', 'jpeg', 'verified', false, 1),
    (v_merchant, v_product_two, NULL, 'https://cdn.example.com/obj.jpg', 'https://cdn.example.com/obj.jpg', 'jpeg', 'verified', false, 2),
    (v_merchant, v_product_two, NULL, 'https://cdn.example.com/zeroprice.jpg', 'https://cdn.example.com/zeroprice.jpg', 'jpeg', 'verified', false, 3),
    (v_merchant, v_product_two, NULL, 'https://cdn.example.com/samecond.jpg', 'https://cdn.example.com/samecond.jpg', 'jpeg', 'verified', false, 4),
    (v_merchant, v_product_swap, NULL, 'https://cdn.example.com/swap-old.jpg', 'https://cdn.example.com/swap-old.jpg', 'jpeg', 'verified', false, 0),
    (v_merchant, v_product_swap, NULL, 'https://cdn.example.com/win.jpg', 'https://cdn.example.com/win.jpg', 'jpeg', 'verified', false, 1),
    (v_merchant, v_product_swap, NULL, 'https://cdn.example.com/lose.jpg', 'https://cdn.example.com/lose.jpg', 'jpeg', 'verified', false, 2),
    (v_merchant, v_product_parent, NULL, 'https://cdn.example.com/morph.jpg', 'https://cdn.example.com/morph.jpg', 'jpeg', 'verified', false, 0),
    (v_merchant, v_product_derivative, NULL, 'https://cdn.example.com/photo.avif', 'https://cdn.example.com/photo.jpg', 'jpeg', 'verified', false, 0),
    (v_merchant, v_product_unflagged, NULL, 'https://cdn.example.com/flagoff.jpg', 'https://cdn.example.com/flagoff.jpg', 'jpeg', 'verified', false, 0),
    (v_merchant, v_product_dethrone, NULL, 'https://cdn.example.com/ref9img.jpg', 'https://cdn.example.com/ref9img.jpg', 'jpeg', 'verified', false, 0),
    (v_merchant, v_product_dethrone, NULL, 'https://cdn.example.com/nan9img.jpg', 'https://cdn.example.com/nan9img.jpg', 'jpeg', 'verified', false, 1),
    (v_merchant_two, v_product_other_merchant, NULL, 'https://cdn.example.com/retired.jpg', 'https://cdn.example.com/retired.jpg', 'jpeg', 'verified', true, 0);

  -- Extractor parity with extractImageCandidates: trims, skips blanks and
  -- malformed elements, ignores non-array and null input.
  SELECT count(*) INTO v_count
  FROM public.feed_manifest_image_urls(
    '["  https://cdn.example.com/a.jpg  ", {"url": "https://cdn.example.com/b.jpg"}, 123, {"url": 456}, "", null]'
  );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'extractor must return exactly the two valid urls, got %', v_count;
  END IF;
  IF EXISTS (SELECT 1 FROM public.feed_manifest_image_urls('{"url": "https://cdn.example.com/a.jpg"}')) THEN
    RAISE EXCEPTION 'extractor must ignore non-array input';
  END IF;
  IF EXISTS (SELECT 1 FROM public.feed_manifest_image_urls(NULL)) THEN
    RAISE EXCEPTION 'extractor must ignore null input';
  END IF;

  -- Listing-condition parity with toGoogleListingCondition.
  IF public.feed_listing_condition(' Open-Box ') IS DISTINCT FROM 'refurbished'
    OR public.feed_listing_condition('UK_USED') IS DISTINCT FROM 'used'
    OR public.feed_listing_condition('refurbished') IS DISTINCT FROM 'refurbished'
    OR public.feed_listing_condition('new') IS DISTINCT FROM 'new'
    OR public.feed_listing_condition('weird') IS NOT NULL
    OR public.feed_listing_condition(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'listing normalization must mirror toGoogleListingCondition';
  END IF;

  -- Deactivation stales the retired product-level row and clears primary.
  UPDATE public.product_offers SET status = 'inactive' WHERE id = v_offer_retire;
  SELECT status, is_primary INTO v_status, v_is_primary
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/retired.jpg';
  IF v_status IS DISTINCT FROM 'stale' OR v_is_primary IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'deactivation must stale the retired row and clear primary';
  END IF;

  -- Sibling imagery on the same product survives the same recompute.
  SELECT count(*) INTO v_count
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product
    AND variant_id IS NULL AND status = 'verified';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'recompute must keep the two surviving rows, got %', v_count;
  END IF;

  -- Variant-scoped rows belong to the image-generation pipeline, even
  -- when their URL was claimed only by the retired offer.
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product
    AND variant_id = v_variant;
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'variant-scoped rows must never be touched';
  END IF;

  -- Other products and merchants are untouched by the recompute.
  SELECT count(*) INTO v_count
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_two
    AND status = 'verified';
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'sibling product rows must be untouched, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_swap
    AND status = 'verified';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'swap product rows must be untouched, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_shared
    AND status = 'verified';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'shared product rows must be untouched, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant
    AND product_id IN (v_product_parent, v_product_derivative, v_product_unflagged, v_product_dethrone)
    AND status = 'verified';
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'transition product rows must be untouched, got %', v_count;
  END IF;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant_two AND product_id = v_product_other_merchant;
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'other merchant rows must be untouched';
  END IF;

  -- Image replacement stales only the retired URL while the
  -- normalized-condition winner keeps protecting its own image.
  UPDATE public.product_offers
  SET images = '["https://cdn.example.com/swap-new.jpg"]'
  WHERE id = v_offer_swapper;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_swap
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/swap-old.jpg';
  IF v_status IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'image replacement must stale the retired url';
  END IF;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_swap
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/lose.jpg';
  IF v_status IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'normalized-condition loser must not protect its image';
  END IF;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_swap
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/win.jpg';
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'normalized-condition winner must protect its image';
  END IF;

  -- A URL shared with a still-active sibling survives until the last
  -- referencing offer goes away (delete path included).
  UPDATE public.product_offers SET status = 'sold_out' WHERE id = v_offer_shared_a;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_shared
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/shared.jpg';
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'shared url must survive while a sibling stays active';
  END IF;
  DELETE FROM public.product_offers WHERE id = v_offer_shared_b;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_shared
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/shared.jpg';
  IF v_status IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'shared url must stale once no active offer references it';
  END IF;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/base.jpg';
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'base row must stay verified once offers retire';
  END IF;

  -- URLs overlapping the parent product images are never orphaned, and
  -- padded-string plus { url } shapes stay claimed while their offer
  -- stays active through the same recompute.
  UPDATE public.product_offers SET status = 'inactive' WHERE id = v_offer_overlap;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_two
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/overlap-base.jpg';
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'product-image overlap must survive offer deactivation';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_two
    AND source_url IN ('https://cdn.example.com/shaped.jpg', 'https://cdn.example.com/obj.jpg')
    AND status = 'verified';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'shaped urls must stay claimed while their offer is active, got %', v_count;
  END IF;

  -- Active-but-ineligible offers (zero price, same-as-parent condition)
  -- protect nothing, unlike a status-only predicate.
  SELECT count(*) INTO v_count
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_two
    AND variant_id IS NULL
    AND source_url IN ('https://cdn.example.com/zeroprice.jpg', 'https://cdn.example.com/samecond.jpg')
    AND status = 'stale';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'ineligible offers must not protect their images, got %', v_count;
  END IF;

  -- Shape-parity cleanup stales exactly the retired rows; each URL is
  -- asserted individually so a missing row cannot hide behind the count.
  UPDATE public.product_offers SET status = 'inactive' WHERE id = v_offer_shapes;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_two
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/shaped.jpg';
  IF v_status IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'padded-string url must end stale';
  END IF;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_two
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/obj.jpg';
  IF v_status IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'object url must end stale';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_two
    AND variant_id IS NULL AND status = 'stale';
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'all four retired rows must end stale, got %', v_count;
  END IF;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_two
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/overlap-base.jpg';
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'product-image overlap must stay verified after cleanup';
  END IF;

  -- A parent condition change re-eligibilizes with no offer event: the
  -- used offer becomes same-as-parent and its row must stale.
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_parent
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/morph.jpg';
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'morph row must start verified';
  END IF;
  UPDATE public.products SET condition = 'used' WHERE id = v_product_parent;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_parent
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/morph.jpg';
  IF v_status IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'parent condition change must stale the ineligible row';
  END IF;

  -- Swapping onto the row's own verified derivative keeps it verified,
  -- mirroring the offer resolver's verified_url match.
  UPDATE public.product_offers
  SET images = '["https://cdn.example.com/photo.jpg"]'
  WHERE id = v_offer_avifswap;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_derivative
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/photo.avif';
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'verified-url match must survive the swap';
  END IF;

  -- Offers on unflagged parents are never claimed, so their rows stale
  -- on the next recompute even while the offer stays active.
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_unflagged
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/flagoff.jpg';
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'flagoff row must start verified';
  END IF;
  UPDATE public.product_offers SET price = 61 WHERE id = v_offer_flagoff;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_unflagged
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/flagoff.jpg';
  IF v_status IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'unflagged parent offers must not protect rows';
  END IF;

  -- Inserting a challenger dethrones the normalized-condition winner
  -- with no update or delete event: open_box sorts before refurbished,
  -- so the incumbent's row must stale on insert alone.
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_dethrone
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/ref9img.jpg';
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'incumbent row must start verified';
  END IF;
  INSERT INTO public.product_offers (id, product_id, merchant_id, condition, price, status, images)
  VALUES (
    v_offer_challenger, v_product_dethrone, v_merchant, 'open_box', 70, 'active',
    '["https://cdn.example.com/box9img.jpg"]'
  );
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_dethrone
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/ref9img.jpg';
  IF v_status IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'insert must stale the dethroned winner row';
  END IF;
  -- Numeric NaN sorts above finite values, so only the explicit guard
  -- excludes it like Number.isFinite does on the feed side.
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_dethrone
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/nan9img.jpg';
  IF v_status IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'NaN price must not protect its image';
  END IF;

  -- One-time repair path: an existing orphan with no referencing offer
  -- stales through the unscoped helper the migration itself calls, while
  -- claimed rows and other scopes behave exactly as scoped recompute.
  INSERT INTO public.product_feed_images
    (merchant_id, product_id, source_url, verified_url, verified_format, status, is_primary, position)
  VALUES
    (v_merchant, v_product, 'https://cdn.example.com/ghost.jpg', 'https://cdn.example.com/ghost.jpg', 'jpeg', 'verified', false, 9);
  SELECT generation INTO v_generation
  FROM public.cache_invalidation_outbox
  WHERE merchant_id = v_merchant_two AND target_kind = 'storefront_slug'
    AND target_id = 'offer-manifest-two';
  PERFORM public.repair_orphaned_feed_manifest();
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/ghost.jpg';
  IF v_status IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'unscoped repair must stale rows with no live claim';
  END IF;
  SELECT generation INTO v_next_generation
  FROM public.cache_invalidation_outbox
  WHERE merchant_id = v_merchant_two AND target_kind = 'storefront_slug'
    AND target_id = 'offer-manifest-two';
  IF v_next_generation IS NULL OR v_next_generation <= COALESCE(v_generation, 0) THEN
    RAISE EXCEPTION 'repair must enqueue affected merchants';
  END IF;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/base.jpg';
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'repair must keep product-claimed rows verified';
  END IF;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/keep.jpg';
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'repair must keep offer-claimed rows verified';
  END IF;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant_two AND product_id = v_product_other_merchant;
  IF v_status IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'repair must reach cross-merchant orphans';
  END IF;
END;
$$;

ROLLBACK;

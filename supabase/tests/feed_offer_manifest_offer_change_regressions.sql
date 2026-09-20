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
  v_variant uuid := '84200000-0000-4000-8000-000000000001';
  v_offer_retire uuid := '84300000-0000-4000-8000-000000000001';
  v_offer_swap uuid := '84300000-0000-4000-8000-000000000002';
  v_offer_shared_a uuid := '84300000-0000-4000-8000-000000000003';
  v_offer_shared_b uuid := '84300000-0000-4000-8000-000000000004';
  v_offer_overlap uuid := '84300000-0000-4000-8000-000000000005';
  v_offer_shapes uuid := '84300000-0000-4000-8000-000000000006';
  v_status text;
  v_is_primary boolean;
  v_count integer;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES
    (v_merchant, 'offer-manifest@example.com', 'Offer Manifest', 'offer-manifest'),
    (v_merchant_two, 'offer-manifest-two@example.com', 'Offer Manifest Two', 'offer-manifest-two');
  INSERT INTO public.products (id, merchant_id, name, price, slug, status, images)
  VALUES
    (v_product, v_merchant, 'Offer Phone', 100, 'offer-phone', 'active',
      '["https://cdn.example.com/base.jpg"]'),
    (v_product_two, v_merchant, 'Offer Phone Two', 120, 'offer-phone-two', 'active', '[]'),
    (v_product_other_merchant, v_merchant_two, 'Offer Phone Other', 130, 'offer-phone-other', 'active', '[]');
  INSERT INTO public.product_offers (id, product_id, merchant_id, condition, price, status, images)
  VALUES
    (v_offer_retire, v_product, v_merchant, 'used', 50, 'active',
      '["https://cdn.example.com/retired.jpg"]'),
    (v_offer_swap, v_product, v_merchant, 'refurbished', 60, 'active',
      '["https://cdn.example.com/swap-old.jpg"]'),
    (v_offer_shared_a, v_product, v_merchant, 'open_box', 70, 'active',
      '["https://cdn.example.com/shared.jpg"]'),
    (v_offer_shared_b, v_product, v_merchant, 'new', 80, 'active',
      '["https://cdn.example.com/shared.jpg"]'),
    (v_offer_overlap, v_product, v_merchant, 'used', 55, 'active',
      '["https://cdn.example.com/base.jpg"]'),
    (v_offer_shapes, v_product, v_merchant, 'refurbished', 65, 'active',
      '["  https://cdn.example.com/shaped.jpg  ", 123, {"url": 456}, "   ", {"url": "https://cdn.example.com/obj.jpg"}, null]');
  INSERT INTO public.product_feed_images
    (merchant_id, product_id, variant_id, source_url, verified_url, verified_format, status, is_primary, position)
  VALUES
    (v_merchant, v_product, NULL, 'https://cdn.example.com/base.jpg', 'https://cdn.example.com/base.jpg', 'jpeg', 'verified', true, 0),
    (v_merchant, v_product, NULL, 'https://cdn.example.com/retired.jpg', 'https://cdn.example.com/retired.jpg', 'jpeg', 'verified', true, 1),
    (v_merchant, v_product, NULL, 'https://cdn.example.com/swap-old.jpg', 'https://cdn.example.com/swap-old.jpg', 'jpeg', 'verified', false, 2),
    (v_merchant, v_product, NULL, 'https://cdn.example.com/shared.jpg', 'https://cdn.example.com/shared.jpg', 'jpeg', 'verified', false, 3),
    (v_merchant, v_product, NULL, 'https://cdn.example.com/shaped.jpg', 'https://cdn.example.com/shaped.jpg', 'jpeg', 'verified', false, 4),
    (v_merchant, v_product, NULL, 'https://cdn.example.com/obj.jpg', 'https://cdn.example.com/obj.jpg', 'jpeg', 'verified', false, 5),
    (v_merchant, v_product, v_variant, 'https://cdn.example.com/retired.jpg', 'https://cdn.example.com/retired.jpg', 'jpeg', 'verified', false, 0),
    (v_merchant, v_product_two, NULL, 'https://cdn.example.com/other.jpg', 'https://cdn.example.com/other.jpg', 'jpeg', 'verified', true, 0),
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

  -- Deactivation stales the retired product-level row and clears primary.
  UPDATE public.product_offers SET status = 'inactive' WHERE id = v_offer_retire;
  SELECT status, is_primary INTO v_status, v_is_primary
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/retired.jpg';
  IF v_status IS DISTINCT FROM 'stale' OR v_is_primary IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'deactivation must stale the retired row and clear primary';
  END IF;

  -- Sibling imagery (including padded-string and { url } shapes claimed
  -- while their offer stays active) survives the same recompute.
  SELECT count(*) INTO v_count
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product
    AND variant_id IS NULL AND status = 'verified';
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'recompute must keep the five surviving rows, got %', v_count;
  END IF;

  -- Variant-scoped rows belong to the image-generation pipeline.
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product
    AND variant_id = v_variant;
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'variant-scoped rows must never be touched';
  END IF;

  -- Image replacement stales only the retired URL.
  UPDATE public.product_offers
  SET images = '["https://cdn.example.com/swap-new.jpg"]'
  WHERE id = v_offer_swap;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/swap-old.jpg';
  IF v_status IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'image replacement must stale the retired url';
  END IF;

  -- A URL shared with a still-active sibling survives until the last
  -- referencing offer goes away (delete path included).
  UPDATE public.product_offers SET status = 'sold_out' WHERE id = v_offer_shared_a;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/shared.jpg';
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'shared url must survive while a sibling stays active';
  END IF;
  DELETE FROM public.product_offers WHERE id = v_offer_shared_b;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/shared.jpg';
  IF v_status IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'shared url must stale once no active offer references it';
  END IF;

  -- URLs overlapping the parent product images are never orphaned.
  UPDATE public.product_offers SET status = 'inactive' WHERE id = v_offer_overlap;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product
    AND variant_id IS NULL AND source_url = 'https://cdn.example.com/base.jpg';
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'product-image overlap must survive offer deactivation';
  END IF;

  -- Shape-parity cleanup: padded and object urls stale with their offer.
  UPDATE public.product_offers SET status = 'inactive' WHERE id = v_offer_shapes;
  SELECT count(*) INTO v_count
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product
    AND variant_id IS NULL AND status = 'stale';
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'all five retired rows must end stale, got %', v_count;
  END IF;

  -- Cross-product and cross-merchant isolation.
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant AND product_id = v_product_two;
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'sibling product rows must be untouched';
  END IF;
  SELECT status INTO v_status
  FROM public.product_feed_images
  WHERE merchant_id = v_merchant_two AND product_id = v_product_other_merchant;
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'other merchant rows must be untouched';
  END IF;
END;
$$;

ROLLBACK;

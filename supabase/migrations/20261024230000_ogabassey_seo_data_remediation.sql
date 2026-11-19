-- Data repair: remediate OgaBassey SEO visibility issues scoped strictly to
-- merchant_id = '6b5cb8a4-5575-456c-b936-8cdfae30db74' (slug = 'ogabassey').
-- 1. Restore the corrupted title on HP EliteBook 850 G3 buying guide.
-- 2. Backfill and normalize 24 published blog_posts rows with null, empty,
--    corrupted ('lhdgpl'), or singleton ('News', 'Review') categories.
-- 3. Atomically migrate '/blog/4800-2' to its canonical slug and upsert
--    public.blog_post_redirects in a single CTE statement after conflict check.
-- 4. Unpublish the active payment-test product ('uba-redvault-payment-test').

DO $$
BEGIN
  -- 1. Restore corrupted title on HP EliteBook 850 G3 buying guide
  UPDATE public.blog_posts AS post
  SET title = 'HP EliteBook 850 G3: Put Software and Battery Before Core i5',
      updated_at = clock_timestamp()
  FROM public.merchants AS merchant
  WHERE merchant.id = post.merchant_id
    AND merchant.id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
    AND merchant.slug = 'ogabassey'
    AND post.id = 'ceb7e74d-9893-4636-8e3e-870933481721'::uuid
    AND post.slug = 'hp-elitebook-850-g3-put-software-and-battery-before-core-i5-1792131688'
    AND post.title IS DISTINCT FROM 'HP EliteBook 850 G3: Put Software and Battery Before Core i5';

  -- 2. Backfill and normalize the 24 verified OgaBassey blog_posts categories
  WITH category_repairs (id, slug, expected_current_category, target_category) AS (
    VALUES
      ('40d9fb4d-c8ed-4504-a75d-8c31c9b0985e'::uuid, 'hp-elitebook-x360-1030-g4-buy-the-touchscreen-only-if-it-passes-1792216757', 'lhdgpl', 'Buying Guides'),
      ('59a75ced-82d2-49da-85f4-7ff500021986'::uuid, 'hp-omnibook-ultra-14-the-future-of-ai-productivity-1769925682', '', 'Laptops'),
      ('deccc064-2d4a-4294-96d0-ef10351016e3'::uuid, 'samsung-drops-a57', 'News', 'Tech News'),
      ('e210d499-e322-4f94-a85f-5ef8967f7d5f'::uuid, 'm4pro-vs-m5', 'Review', 'Reviews'),
      ('82b225ad-4929-4cf2-97e5-932e878352f1'::uuid, 'android-17-everything-you-need-to-know', NULL, 'Smartphones'),
      ('323d6284-7d82-43f9-81d5-9dd1e4062b18'::uuid, 'oneplus-nord-ce-6-vs-nord-ce-6-lite-which-battery-king-should-you-buy-1778306534', NULL, 'Smartphones'),
      ('4ac3d186-601d-4f11-a6b4-d926d5263aa8'::uuid, 'airpods-max-vs-airpods-max-2-which-one-should-you-actually-buy-in-2026', NULL, 'Accessories'),
      ('053cd0e4-2c50-4681-821f-c567c528c3c3'::uuid, 'samsung-galaxy-a37-review-the-midrange-sweet-spot', NULL, 'Smartphones'),
      ('afe81907-5059-454f-a80b-45289a0fc368'::uuid, 'the-sound-of-2026-ranking-the-years-best-flagship-earbuds', NULL, 'Accessories'),
      ('5d3fb233-861c-4f7a-8d26-8afdc786e7b9'::uuid, 'samsung-galaxy-s26-plus-review-the-ultimate-middle-child-refinement', NULL, 'Smartphones'),
      ('5e2e5baf-7cc2-4dea-8e91-8714dc605472'::uuid, 'macbook-pro-m3-pro-2026-review-the-sweet-spot-', NULL, 'Laptops'),
      ('daffff99-81a9-410f-9fb5-7e4708c80779'::uuid, 'openai-ends-sora', NULL, 'Tech News'),
      ('cdcd8ba1-9a7a-4bf5-ba00-ceaee4b40f81'::uuid, 'samsung-galaxy-a57-vs-redmi-note-15-pro-plus', NULL, 'Smartphones'),
      ('094b79c2-d8d3-4399-8f25-63a947a68195'::uuid, 'samsung-galaxy-s23-ultra-in-2026', NULL, 'Smartphones'),
      ('e32e1eeb-c30f-4845-a16d-c1d5a51c623e'::uuid, 'macbook-neo-apple-cheapest-mac-explained', NULL, 'Laptops'),
      ('33e1ba42-8d06-4e9d-875e-4d3b13695c4e'::uuid, 'iphone-16-vs-iphone-17', NULL, 'Smartphones'),
      ('cc5a547f-4809-4340-9da1-a49e426ddf69'::uuid, 'battle-of-the-ai-which-one-is-worth-your-money', NULL, 'Tech News'),
      ('be0777e0-2459-496f-829d-1645d3b56911'::uuid, 'redmi-note-15-pro-200mp-camera-price-in-nigeria', NULL, 'Smartphones'),
      ('e3a3d880-1389-4348-86bf-f505d8ffd729'::uuid, 'val-in-time-the-everything-you-need-pairings', NULL, 'Buying Guides'),
      ('d6b35116-9a9f-44b1-857d-5139ad2dabf0'::uuid, 'samsung-galaxy-book6-ultra-the-future-of-laptops-in-nigeria-1769839284', NULL, 'Laptops'),
      ('6a6208c7-8361-4e29-bce9-06572ade84bf'::uuid, 'infinix-note-edge-slim-design-meets-massive-battery-1769407290', NULL, 'Smartphones'),
      ('678cd140-f4a9-4351-869f-e6fa5ff24414'::uuid, 'top-5-smartphone-trends-of-2026', NULL, 'Smartphones'),
      ('c955f9e6-d01f-4ed5-978d-d17a7dbd0ea7'::uuid, 'everything-we-know-about-apples-creator-studio-', NULL, 'Tech News'),
      ('8ad0167e-b3fd-462e-839e-29b05619d519'::uuid, 'snapdragon-x2-series-on-windows', NULL, 'Laptops')
  )
  UPDATE public.blog_posts AS post
  SET category = repair.target_category,
      updated_at = clock_timestamp()
  FROM category_repairs AS repair,
       public.merchants AS merchant
  WHERE merchant.id = post.merchant_id
    AND merchant.id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
    AND merchant.slug = 'ogabassey'
    AND post.id = repair.id
    AND post.slug = repair.slug
    AND post.category IS NOT DISTINCT FROM repair.expected_current_category
    AND post.category IS DISTINCT FROM repair.target_category;

  -- 3. Atomically migrate '/blog/4800-2' and upsert public.blog_post_redirects
  IF EXISTS (
    SELECT 1
    FROM public.blog_posts AS target
    JOIN public.merchants AS merchant ON merchant.id = target.merchant_id
    WHERE merchant.id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
      AND merchant.slug = 'ogabassey'
      AND target.id = 'c5aa6528-4a70-4993-be50-1ce1094d931a'::uuid
      AND target.slug = '4800-2'
      AND (
        EXISTS (
          SELECT 1
          FROM public.blog_posts AS conflicting
          WHERE conflicting.merchant_id = target.merchant_id
            AND conflicting.slug = 'google-pixel-phones-in-nigeria-are-they-worth-buying-in-2026'
            AND conflicting.id <> target.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.blog_post_redirects AS conflicting_redirect
          WHERE conflicting_redirect.merchant_id = target.merchant_id
            AND conflicting_redirect.source_slug = 'google-pixel-phones-in-nigeria-are-they-worth-buying-in-2026'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Cannot migrate Ogabassey 4800-2 blog slug: destination slug already conflicts';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'blog_post_redirects'
      AND column_name = 'target_slug'
  ) THEN
    EXECUTE $sql$
      WITH migrated_post AS (
        UPDATE public.blog_posts AS post
        SET slug = 'google-pixel-phones-in-nigeria-are-they-worth-buying-in-2026',
            updated_at = clock_timestamp()
        FROM public.merchants AS merchant
        WHERE merchant.id = post.merchant_id
          AND merchant.id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
          AND merchant.slug = 'ogabassey'
          AND post.id = 'c5aa6528-4a70-4993-be50-1ce1094d931a'::uuid
          AND post.slug = '4800-2'
        RETURNING post.id, post.merchant_id, post.slug
      )
      INSERT INTO public.blog_post_redirects (
        merchant_id,
        source_slug,
        target_post_id,
        target_slug
      )
      SELECT
        migrated_post.merchant_id,
        '4800-2',
        migrated_post.id,
        migrated_post.slug
      FROM migrated_post
      ON CONFLICT (merchant_id, source_slug)
      DO UPDATE SET
        target_post_id = EXCLUDED.target_post_id,
        target_slug = EXCLUDED.target_slug,
        updated_at = clock_timestamp()
    $sql$;
  ELSE
    WITH migrated_post AS (
      UPDATE public.blog_posts AS post
      SET slug = 'google-pixel-phones-in-nigeria-are-they-worth-buying-in-2026',
          updated_at = clock_timestamp()
      FROM public.merchants AS merchant
      WHERE merchant.id = post.merchant_id
        AND merchant.id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
        AND merchant.slug = 'ogabassey'
        AND post.id = 'c5aa6528-4a70-4993-be50-1ce1094d931a'::uuid
        AND post.slug = '4800-2'
      RETURNING post.id, post.merchant_id
    )
    INSERT INTO public.blog_post_redirects (
      merchant_id,
      source_slug,
      target_post_id
    )
    SELECT
      migrated_post.merchant_id,
      '4800-2',
      migrated_post.id
    FROM migrated_post
    ON CONFLICT (merchant_id, source_slug)
    DO UPDATE SET
      target_post_id = EXCLUDED.target_post_id,
      updated_at = clock_timestamp();
  END IF;

  -- 4. Unpublish the active payment-test product ('uba-redvault-payment-test')
  UPDATE public.products AS product
  SET status = 'draft',
      updated_at = clock_timestamp()
  FROM public.merchants AS merchant
  WHERE merchant.id = product.merchant_id
    AND merchant.id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
    AND merchant.slug = 'ogabassey'
    AND product.id = 'f6f4261f-8cc8-42c4-941c-e8d3483c6628'::uuid
    AND product.slug = 'uba-redvault-payment-test'
    AND product.status IS DISTINCT FROM 'draft';
END;
$$;

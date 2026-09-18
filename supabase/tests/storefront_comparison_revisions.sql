-- Run after 20260911100000_add_storefront_comparison_revisions.sql.
-- This creates only rollback-scoped fixtures inside a transaction.

BEGIN;

-- Match the repository's audited SQL fixture setup without granting the
-- service role direct access to the private revision ledger.
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_after bigint;
  v_before bigint;
  v_before_transfer bigint;
  v_merchant_id uuid := gen_random_uuid();
  v_new_merchant_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_slug text := 'comparison-revision-' || replace(v_merchant_id::text, '-', '');
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug, is_published)
  VALUES (
    v_merchant_id,
    v_slug || '@example.invalid',
    'Comparison revision regression fixture',
    v_slug,
    TRUE
  );

  INSERT INTO public.products (
    id, merchant_id, name, price, slug, status, manage_stock, stock, stock_quantity
  ) VALUES (
    v_product_id, v_merchant_id, 'Comparison revision fixture product',
    100, v_slug || '-product', 'active', TRUE, 10, 10
  );

  SELECT revision.revision INTO v_before
  FROM public.storefront_comparison_revisions AS revision
  WHERE revision.merchant_id = v_merchant_id;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'active product insert must create a comparison revision';
  END IF;

  BEGIN
    UPDATE public.products
    SET price = price + 1
    WHERE id = v_product_id;
    RAISE EXCEPTION 'force nested revision rollback';
  EXCEPTION
    WHEN raise_exception THEN
      NULL;
  END;

  IF (SELECT revision.revision
      FROM public.storefront_comparison_revisions AS revision
      WHERE revision.merchant_id = v_merchant_id) <> v_before THEN
    RAISE EXCEPTION 'rolled-back comparison input mutation must not advance revision';
  END IF;

  -- Checkout stock writes retain broad cache invalidation, but comparison
  -- eligibility reads neither stock column. They must not rotate its remote
  -- cache key just because inventory changed.
  UPDATE public.products
  SET stock = coalesce(stock, 0) + 1,
      stock_quantity = coalesce(stock_quantity, 0) + 1
  WHERE id = v_product_id;

  IF (SELECT revision.revision
      FROM public.storefront_comparison_revisions AS revision
      WHERE revision.merchant_id = v_merchant_id) <> v_before THEN
    RAISE EXCEPTION 'stock-only product updates must not advance the comparison revision';
  END IF;

  -- Price is selected by the comparison inventory and changes curation, so it
  -- must advance exactly once inside the same transaction.
  UPDATE public.products
  SET price = price + 1
  WHERE id = v_product_id;

  SELECT revision.revision
  INTO v_after
  FROM public.storefront_comparison_revisions AS revision
  WHERE revision.merchant_id = v_merchant_id;

  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'comparison input mutation must advance revision: before %, after %', v_before, v_after;
  END IF;

  PERFORM public.enqueue_storefront_cache_targets(v_merchant_id);

  SELECT revision.revision
  INTO v_after
  FROM public.storefront_comparison_revisions AS revision
  WHERE revision.merchant_id = v_merchant_id;

  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'general cache enqueue must not advance the comparison revision';
  END IF;

  DELETE FROM public.cache_invalidation_outbox
  WHERE merchant_id = v_merchant_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.storefront_comparison_revisions AS revision
    WHERE revision.merchant_id = v_merchant_id
      AND revision.revision = v_after
  ) THEN
    RAISE EXCEPTION 'outbox cleanup must not reset the comparison revision';
  END IF;

  UPDATE public.merchants
  SET is_published = FALSE
  WHERE id = v_merchant_id;

  IF public.get_published_storefront_comparison_revision(v_merchant_id) IS NOT NULL THEN
    RAISE EXCEPTION 'draft merchants must not expose a comparison revision';
  END IF;

  UPDATE public.merchants
  SET is_published = TRUE
  WHERE id = v_merchant_id;

  IF public.get_published_storefront_comparison_revision(v_merchant_id) <> v_after + 2 THEN
    RAISE EXCEPTION 'publication mutations must advance the comparison revision';
  END IF;

  -- A catalog ownership move changes both tenants' compare inventory. The old
  -- published store must invalidate the removal and the destination must get
  -- a fresh revision even when it had no pre-seeded ledger row.
  INSERT INTO public.merchants (id, email, business_name, slug, is_published)
  VALUES (
    v_new_merchant_id,
    'comparison-revision-transfer-' || v_new_merchant_id::text || '@example.invalid',
    'Comparison revision transfer fixture',
    'comparison-revision-transfer-' || replace(v_new_merchant_id::text, '-', ''),
    FALSE
  );

  SELECT revision.revision
  INTO v_before_transfer
  FROM public.storefront_comparison_revisions AS revision
  WHERE revision.merchant_id = v_merchant_id;

  UPDATE public.products
  SET merchant_id = v_new_merchant_id
  WHERE id = v_product_id;

  IF (SELECT revision.revision
      FROM public.storefront_comparison_revisions AS revision
      WHERE revision.merchant_id = v_merchant_id) <> v_before_transfer + 1 THEN
    RAISE EXCEPTION 'product merchant transfer must advance the source revision';
  END IF;

  IF (SELECT revision.revision
      FROM public.storefront_comparison_revisions AS revision
      WHERE revision.merchant_id = v_new_merchant_id) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'product merchant transfer must seed the destination revision';
  END IF;
END;
$$;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.storefront_comparison_revisions', 'SELECT')
    OR has_table_privilege('authenticated', 'public.storefront_comparison_revisions', 'SELECT')
    OR has_table_privilege('service_role', 'public.storefront_comparison_revisions', 'SELECT') THEN
    RAISE EXCEPTION 'comparison revision ledger must not grant direct reads';
  END IF;

  IF NOT has_function_privilege(
    'anon',
    'public.get_published_storefront_comparison_revision(uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.get_published_storefront_comparison_revision(uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.get_published_storefront_comparison_revision(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'comparison revision RPC grant contract changed';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.storefront_comparison_revisions'::regclass
      AND constraint_row.contype = 'f'
  ) THEN
    RAISE EXCEPTION 'comparison revision ledger must survive merchant deletion and UUID reuse';
  END IF;
END;
$$;

ROLLBACK;

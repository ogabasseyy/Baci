-- Run after 20260911100000_add_storefront_comparison_revisions.sql.
-- Exercises each comparison-input trigger using rollback-only fixtures.

BEGIN;

-- Merchant fixture writes use the existing audit actor contract.
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_after bigint;
  v_before bigint;
  v_category_a_id uuid := gen_random_uuid();
  v_category_b_id uuid := gen_random_uuid();
  v_merchant_id uuid := gen_random_uuid();
  v_product_a_id uuid := gen_random_uuid();
  v_product_b_id uuid := gen_random_uuid();
  v_slug text := 'comparison-trigger-' || replace(v_merchant_id::text, '-', '');
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug, is_published)
  VALUES (
    v_merchant_id,
    v_slug || '@example.invalid',
    'Comparison trigger regression fixture',
    v_slug,
    TRUE
  );

  INSERT INTO public.products (id, merchant_id, name, price, slug, status)
  VALUES
    (v_product_a_id, v_merchant_id, 'Comparison trigger fixture A', 100, v_slug || '-a', 'active'),
    (v_product_b_id, v_merchant_id, 'Comparison trigger fixture B', 200, v_slug || '-b', 'active');

  INSERT INTO public.categories (id, merchant_id, name, slug, is_active)
  VALUES
    (v_category_a_id, v_merchant_id, 'Comparison category A', v_slug || '-a', TRUE),
    (v_category_b_id, v_merchant_id, 'Comparison category B', v_slug || '-b', TRUE);

  SELECT revision.revision INTO v_before
  FROM public.storefront_comparison_revisions AS revision
  WHERE revision.merchant_id = v_merchant_id;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'comparison fixtures must create a revision ledger row';
  END IF;

  UPDATE public.categories
  SET name = 'Comparison category A renamed'
  WHERE id = v_category_a_id;

  SELECT revision.revision INTO v_after
  FROM public.storefront_comparison_revisions AS revision
  WHERE revision.merchant_id = v_merchant_id;
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'category compare input edit must advance revision once';
  END IF;

  UPDATE public.categories
  SET name = name
  WHERE id = v_category_a_id;

  IF (SELECT revision.revision
      FROM public.storefront_comparison_revisions AS revision
      WHERE revision.merchant_id = v_merchant_id) <> v_after THEN
    RAISE EXCEPTION 'no-op category compare input update must not advance revision';
  END IF;

  INSERT INTO public.product_categories (product_id, category_id)
  VALUES (v_product_a_id, v_category_a_id);

  SELECT revision.revision INTO v_before
  FROM public.storefront_comparison_revisions AS revision
  WHERE revision.merchant_id = v_merchant_id;
  IF v_before <> v_after + 1 THEN
    RAISE EXCEPTION 'category membership insert must advance revision once';
  END IF;

  UPDATE public.product_categories
  SET category_id = v_category_b_id
  WHERE product_id = v_product_a_id
    AND category_id = v_category_a_id;

  SELECT revision.revision INTO v_after
  FROM public.storefront_comparison_revisions AS revision
  WHERE revision.merchant_id = v_merchant_id;
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'category membership move must advance revision once';
  END IF;

  INSERT INTO public.product_key_specs (product_id, ram_gb)
  VALUES (v_product_a_id, 8);

  SELECT revision.revision INTO v_before
  FROM public.storefront_comparison_revisions AS revision
  WHERE revision.merchant_id = v_merchant_id;
  IF v_before <> v_after + 1 THEN
    RAISE EXCEPTION 'key spec insert must advance revision once';
  END IF;

  UPDATE public.product_key_specs
  SET ram_gb = 12
  WHERE product_id = v_product_a_id;

  SELECT revision.revision INTO v_after
  FROM public.storefront_comparison_revisions AS revision
  WHERE revision.merchant_id = v_merchant_id;
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'key spec edit must advance revision once';
  END IF;

  UPDATE public.product_key_specs
  SET product_id = v_product_b_id
  WHERE product_id = v_product_a_id;

  IF (SELECT revision.revision
      FROM public.storefront_comparison_revisions AS revision
      WHERE revision.merchant_id = v_merchant_id) <> v_after + 2 THEN
    RAISE EXCEPTION 'key spec move must advance both active product inputs';
  END IF;
END;
$$;

ROLLBACK;

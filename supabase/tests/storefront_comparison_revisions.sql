-- Run after 20260911100000_add_storefront_comparison_revisions.sql.
-- This mutates an existing published merchant only inside a transaction.

BEGIN;

DO $$
DECLARE
  v_after bigint;
  v_before bigint;
  v_merchant_id uuid;
BEGIN
  SELECT merchant.id
  INTO v_merchant_id
  FROM public.merchants AS merchant
  WHERE merchant.is_published IS TRUE
  ORDER BY merchant.id
  LIMIT 1;

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'storefront comparison revision test requires a published merchant fixture';
  END IF;

  SELECT revision.revision
  INTO v_before
  FROM public.storefront_comparison_revisions AS revision
  WHERE revision.merchant_id = v_merchant_id;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'published merchant % has no seeded comparison revision', v_merchant_id;
  END IF;

  BEGIN
    PERFORM public.enqueue_storefront_cache_targets(v_merchant_id);
    RAISE EXCEPTION 'force nested revision rollback';
  EXCEPTION
    WHEN raise_exception THEN
      NULL;
  END;

  IF (SELECT revision.revision
      FROM public.storefront_comparison_revisions AS revision
      WHERE revision.merchant_id = v_merchant_id) <> v_before THEN
    RAISE EXCEPTION 'rolled-back enqueue must not advance the comparison revision';
  END IF;

  PERFORM public.enqueue_storefront_cache_targets(v_merchant_id);

  SELECT revision.revision
  INTO v_after
  FROM public.storefront_comparison_revisions AS revision
  WHERE revision.merchant_id = v_merchant_id;

  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'comparison revision must increment atomically: before %, after %', v_before, v_after;
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

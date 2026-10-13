-- Share related_identifiers and generation across slug/hostname rows emitted
-- by one enqueue_storefront_cache_targets call so the drain SingleFlight key
-- (merchant_id + generation + provider tags/hostnames) can coalesce equivalent
-- provider work from the same merchant mutation.

CREATE OR REPLACE FUNCTION public.enqueue_storefront_cache_targets(
  p_merchant_id uuid,
  p_additional_slug text DEFAULT NULL,
  p_additional_hostname text DEFAULT NULL,
  p_product_slugs text[] DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_slug text;
  v_target text;
  v_slug_targets text[];
  v_hostname_targets text[];
  v_related_identifiers text[];
  v_shared_generation bigint;
BEGIN
  SELECT merchant.slug INTO v_slug
  FROM public.merchants AS merchant
  WHERE merchant.id = p_merchant_id;
  IF v_slug IS NULL THEN
    RETURN;
  END IF;

  SELECT coalesce(pg_catalog.array_agg(candidate ORDER BY candidate), '{}')
  INTO v_slug_targets
  FROM (
    SELECT DISTINCT candidate
    FROM (
      SELECT v_slug AS candidate
      UNION ALL SELECT p_additional_slug
      UNION ALL
      SELECT alias.old_slug
      FROM public.merchant_slug_aliases AS alias
      WHERE alias.merchant_id = p_merchant_id
    ) AS targets
    WHERE candidate IS NOT NULL
  ) AS distinct_slugs;

  SELECT coalesce(pg_catalog.array_agg(candidate ORDER BY candidate), '{}')
  INTO v_hostname_targets
  FROM (
    SELECT DISTINCT candidate
    FROM (
      SELECT domain_row.domain AS candidate
      FROM public.domains AS domain_row
      WHERE domain_row.merchant_id = p_merchant_id
        AND domain_row.status = 'active'
        AND domain_row.verified_at IS NOT NULL
      UNION ALL SELECT p_additional_hostname
    ) AS targets
    WHERE candidate IS NOT NULL
  ) AS distinct_hostnames;

  SELECT coalesce(pg_catalog.array_agg(value ORDER BY value), '{}')
  INTO v_related_identifiers
  FROM (
    SELECT DISTINCT value
    FROM pg_catalog.unnest(
      coalesce(v_slug_targets, '{}') || coalesce(v_hostname_targets, '{}')
    ) AS value
    WHERE value IS NOT NULL
    ORDER BY value
    LIMIT 40
  ) AS related;

  FOREACH v_target IN ARRAY coalesce(v_slug_targets, '{}')
  LOOP
    PERFORM public.enqueue_cache_invalidation_target(
      p_merchant_id,
      'storefront_slug',
      v_target,
      v_related_identifiers,
      p_product_slugs
    );
  END LOOP;

  FOREACH v_target IN ARRAY coalesce(v_hostname_targets, '{}')
  LOOP
    PERFORM public.enqueue_cache_invalidation_target(
      p_merchant_id,
      'storefront_hostname',
      v_target,
      v_related_identifiers,
      p_product_slugs
    );
  END LOOP;

  IF coalesce(pg_catalog.cardinality(v_slug_targets), 0) > 0
    OR coalesce(pg_catalog.cardinality(v_hostname_targets), 0) > 0
  THEN
    SELECT pg_catalog.max(outbox.generation)
    INTO v_shared_generation
    FROM public.cache_invalidation_outbox AS outbox
    WHERE outbox.merchant_id = p_merchant_id
      AND (
        (
          outbox.target_kind = 'storefront_slug'
          AND outbox.target_id = ANY (v_slug_targets)
        )
        OR (
          outbox.target_kind = 'storefront_hostname'
          AND outbox.target_id = ANY (v_hostname_targets)
        )
      );

    UPDATE public.cache_invalidation_outbox AS outbox
    SET generation = v_shared_generation,
        updated_at = pg_catalog.now()
    WHERE outbox.merchant_id = p_merchant_id
      AND v_shared_generation IS NOT NULL
      AND (
        (
          outbox.target_kind = 'storefront_slug'
          AND outbox.target_id = ANY (v_slug_targets)
        )
        OR (
          outbox.target_kind = 'storefront_hostname'
          AND outbox.target_id = ANY (v_hostname_targets)
        )
      )
      AND outbox.generation <> v_shared_generation;
  END IF;

  FOR v_target IN
    SELECT DISTINCT pg_catalog.btrim(candidate)
    FROM pg_catalog.unnest(coalesce(p_product_slugs, '{}')) AS candidate
    WHERE candidate IS NOT NULL
  LOOP
    PERFORM public.enqueue_storefront_product_cache_target(
      p_merchant_id,
      v_target
    );
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_storefront_cache_targets(
  uuid, text, text, text[]
) FROM PUBLIC, anon, authenticated, service_role;

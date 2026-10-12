-- PR #3555 review follow-up: lock the product row before activation.
--
-- The atomic publish recheck reads the product predicates under the
-- UPDATE's statement snapshot, so a catalog change committing after
-- the snapshot but before activation commits would still publish a
-- stale binding. Activation now acquires the candidate product row
-- BEFORE the policy row (products-first, matching the order path,
-- which locks products in snapshot validation before the policy row
-- in the boundary trigger and order guard). Holding the lock through
-- commit serializes publication with catalog writers: a concurrent
-- update waits, then activation validates its committed version.
--
-- FOR SHARE, not FOR UPDATE: sufficient to block concurrent writes,
-- and self-compatible, so activation can never deadlock with the
-- order/application paths' own FOR SHARE product reads (the reserve
-- chain takes no product-row locks at all). The atomic publish
-- recheck stays as defense in depth.

CREATE OR REPLACE FUNCTION private.configure_uba_redvault_live_pilot(
  p_enabled boolean, p_product_id uuid, p_expires_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_enabled IS TRUE AND p_product_id IS NOT NULL THEN
    PERFORM 1 FROM public.products AS product
    WHERE product.id = p_product_id FOR SHARE;
  END IF;
  PERFORM 1 FROM private.uba_redvault_live_pilot_policy WHERE singleton FOR UPDATE;
  IF EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy
      WHERE singleton AND reserved_attempt_id IS NOT NULL)
    AND (p_enabled IS TRUE OR p_product_id IS NOT NULL OR p_expires_at IS NOT NULL) THEN
    RAISE EXCEPTION 'redvault_pilot_consumed_binding_immutable';
  END IF;
  IF p_enabled IS TRUE AND EXISTS (
    SELECT 1
    FROM private.uba_redvault_live_pilot_policy AS policy
    JOIN private.uba_redvault_applications AS application
      ON application.user_id = policy.user_id
    WHERE policy.singleton
      AND policy.product_id IS NOT NULL
      AND p_product_id IS DISTINCT FROM policy.product_id
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_bound_product_immutable';
  END IF;
  IF p_enabled IS TRUE AND (p_product_id IS NULL OR p_expires_at IS NULL
    OR p_expires_at <= pg_catalog.now() OR p_expires_at > pg_catalog.now() + interval '14 days') THEN
    RAISE EXCEPTION 'redvault_pilot_configuration_invalid';
  END IF;
  IF p_enabled IS TRUE AND NOT EXISTS (
    SELECT 1 FROM public.products AS product
    WHERE product.id = p_product_id
      AND product.merchant_id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
      AND product.price = 100 AND product.has_variants IS FALSE
      AND product.inventory_tracking_policy = 'off'
      AND NOT EXISTS (SELECT 1 FROM public.order_items AS prior_item
        WHERE prior_item.product_id = product.id
          AND NOT (
            p_product_id = (SELECT policy.product_id
              FROM private.uba_redvault_live_pilot_policy AS policy WHERE policy.singleton)
            AND EXISTS (SELECT 1 FROM private.uba_redvault_applications AS application
              WHERE application.order_id = prior_item.order_id
                AND application.user_id = (SELECT policy.user_id
                  FROM private.uba_redvault_live_pilot_policy AS policy WHERE policy.singleton))
          ))
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_product_not_dedicated';
  END IF;
  IF p_enabled IS TRUE AND EXISTS (
    SELECT 1 FROM public.products AS product
    WHERE product.id = p_product_id
      AND product.status IS DISTINCT FROM 'active'
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_product_not_active';
  END IF;
  IF p_enabled IS TRUE AND EXISTS (
    SELECT 1 FROM public.products AS product
    WHERE product.id = p_product_id
      AND NOT private.is_uba_redvault_negotiable_product(product.brand, product.name)
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_product_not_eligible';
  END IF;
  UPDATE private.uba_redvault_live_pilot_policy
  SET enabled = COALESCE(p_enabled, false),
      product_id = CASE WHEN p_enabled THEN p_product_id ELSE product_id END,
      expires_at = CASE WHEN p_enabled THEN p_expires_at ELSE expires_at END,
      updated_at = pg_catalog.now()
  WHERE singleton
    AND (
      p_enabled IS NOT TRUE
      OR (
        EXISTS (
          SELECT 1 FROM public.products AS product
          WHERE product.id = p_product_id
            AND product.merchant_id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
            AND product.price = 100 AND product.has_variants IS FALSE
            AND product.inventory_tracking_policy = 'off'
            AND product.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM public.order_items AS prior_item
              WHERE prior_item.product_id = product.id
                AND NOT (
                  p_product_id = (SELECT policy.product_id
                    FROM private.uba_redvault_live_pilot_policy AS policy WHERE policy.singleton)
                  AND EXISTS (SELECT 1 FROM private.uba_redvault_applications AS application
                    WHERE application.order_id = prior_item.order_id
                      AND application.user_id = (SELECT policy.user_id
                        FROM private.uba_redvault_live_pilot_policy AS policy WHERE policy.singleton))
                ))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.products AS product
          WHERE product.id = p_product_id
            AND NOT private.is_uba_redvault_negotiable_product(product.brand, product.name)
        )
      )
    );
  IF p_enabled IS TRUE AND NOT FOUND THEN
    RAISE EXCEPTION 'redvault_pilot_product_changed_during_activation';
  END IF;
END;
$$;
ALTER FUNCTION private.configure_uba_redvault_live_pilot(boolean, uuid, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.configure_uba_redvault_live_pilot(boolean, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

-- PR #3555 review follow-up: atomic activation publish.
--
-- configure_uba_redvault_live_pilot validated the product shape, prior
-- use, and brand eligibility in separate reads, then published the
-- policy binding in a later statement. A merchant catalog update
-- committing between those reads and the publish (reprice, variant
-- enablement, tracking change, rename to an ineligible brand) would
-- leave activation reporting success for a product that availability
-- and order creation then reject.
--
-- The publish UPDATE now re-validates the dedicated-product and
-- eligibility predicates in its own WHERE clause, so the checks and the
-- write execute atomically in one statement: a catalog change that
-- lands before the publish is observed and activation raises
-- redvault_pilot_product_changed_during_activation (operator retries
-- with a reviewed product), while anything landing after is
-- post-publish drift, which the availability recheck and order guards
-- already fail closed on.
--
-- Deliberately lock-free: the order path can hold product-row locks
-- while taking FOR SHARE on the policy row (see
-- 20261006160000_uba_redvault_pilot_activation_lock_and_policy_indexes.sql),
-- so taking policy-then-product locks here would invert that order and
-- admit AB-BA deadlock with concurrent checkouts. The atomic recheck
-- provides the same guarantee without a new lock edge and without
-- blocking catalog writers behind activation.

CREATE OR REPLACE FUNCTION private.configure_uba_redvault_live_pilot(
  p_enabled boolean, p_product_id uuid, p_expires_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
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

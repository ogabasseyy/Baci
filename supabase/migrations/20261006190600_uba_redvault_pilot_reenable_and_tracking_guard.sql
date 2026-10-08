-- PR #3555 review follow-up: activation product requirements and
-- same-product recovery.
--
-- (1) A no-variant product with serialized inventory tracking
-- (serialized_strict, serialized_then_unlimited) passed activation, but
-- normal order creation claims inventory units into item fulfillment data
-- mirrored onto orders.fulfillment_details, which the pilot binding guard
-- rejects. Every pilot checkout for such a product would fail with
-- redvault_pilot_order_binding_mismatch. Activation now requires the
-- product-level tracking policy to be 'off' (pilot products have no
-- variants, so no variant policy can override it).
--
-- (2) Re-enabling the preserved product after its pilot order exists was
-- impossible: the dedicated-product check counts the pilot order's own
-- lines as prior use. When re-enabling the SAME preserved product, order
-- items belonging to pilot-user applications are now excluded from the
-- prior-use check, while unrelated prior orders still block. Rotation to
-- a different product with applications stays forbidden (20261006190500).

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
  UPDATE private.uba_redvault_live_pilot_policy
  SET enabled = COALESCE(p_enabled, false),
      product_id = CASE WHEN p_enabled THEN p_product_id ELSE product_id END,
      expires_at = CASE WHEN p_enabled THEN p_expires_at ELSE expires_at END,
      updated_at = pg_catalog.now()
  WHERE singleton;
END;
$$;
ALTER FUNCTION private.configure_uba_redvault_live_pilot(boolean, uuid, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.configure_uba_redvault_live_pilot(boolean, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

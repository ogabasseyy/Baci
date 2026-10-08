-- PR #3555 review follow-up: activation product eligibility.
--
-- Activation bound any dedicated NGN 100 product with variants and
-- inventory tracking disabled, including brands the shared REDVAULT
-- eligibility policy excludes (budget brands such as Infinix/Tecno,
-- Samsung A-series). Configuration would then succeed and availability
-- would advertise the pilot, while computeRedvaultOrderQuote produced a
-- zero discount and /api/orders rejected every checkout with
-- REDVAULT_NOT_ELIGIBLE before the pilot could run. Activation now
-- enforces the shared policy in SQL, and the availability route rechecks
-- eligibility against the live catalog row on every pilot response.
--
-- private.is_uba_redvault_negotiable_product mirrors
-- isRedvaultEligibleProduct (packages/shared/src/lib/negotiation-policy.ts
-- via redvault-eligibility.ts): lowercase, collapse non-alphanumerics to
-- single spaces, then reject whole-token budget-brand keywords and
-- Samsung A-series models. Empty brand+name stays eligible, matching the
-- shared policy. The normalized text contains only [a-z0-9 ] so the
-- (^| ) / ( |$) anchors replicate the shared policy's \b word
-- boundaries exactly.

CREATE OR REPLACE FUNCTION private.is_uba_redvault_negotiable_product(
  p_brand text, p_name text
) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH normalized AS (
    SELECT
      btrim(regexp_replace(lower(coalesce(p_brand, '')), '[^a-z0-9]+', ' ', 'g'), ' ') AS brand,
      btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', ' ', 'g'), ' ') AS name
  ),
  combined AS (
    SELECT brand, name, NULLIF(btrim(brand || ' ' || name), ' ') AS text
    FROM normalized
  )
  SELECT
    text IS NULL
    OR NOT (
      text ~ '(^| )(infinix|tecno|vivo|redmi|xiaomi|oppo|itel|honor)( |$)'
      OR (
        text ~ '(^| )(samsung|galaxy)( |$)'
        AND (
          text ~ '(^| )galaxy a ?series( |$)'
          OR text ~ '(^| )samsung galaxy a ?series( |$)'
          OR text ~ '(^| )samsung a ?series( |$)'
          OR text ~ '(^| )galaxy a ?[0-9]{1,3}[a-z]*( |$)'
          OR text ~ '(^| )samsung a ?[0-9]{1,3}[a-z]*( |$)'
          OR (
            text ~ '(^| )samsung( |$)'
            AND name ~ '(^| )a ?[0-9]{1,3}[a-z]*( |$)'
          )
        )
      )
    )
  FROM combined;
$$;
ALTER FUNCTION private.is_uba_redvault_negotiable_product(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.is_uba_redvault_negotiable_product(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

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
  WHERE singleton;
END;
$$;
ALTER FUNCTION private.configure_uba_redvault_live_pilot(boolean, uuid, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.configure_uba_redvault_live_pilot(boolean, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

-- PR #3555 round-5 review follow-up: split of 20260928120000 (part 1/5): policy table, RLS, seed, and activation.
CREATE TABLE private.uba_redvault_live_pilot_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  user_id uuid NOT NULL DEFAULT '70261bce-d358-45a4-9ede-8b9d71fb3bd9'::uuid
    CHECK (user_id = '70261bce-d358-45a4-9ede-8b9d71fb3bd9'::uuid),
  merchant_id uuid NOT NULL DEFAULT '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
    CHECK (merchant_id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid),
  product_id uuid,
  expires_at timestamptz,
  reserved_order_id uuid REFERENCES public.orders(id) ON DELETE RESTRICT,
  reserved_attempt_id uuid REFERENCES private.uba_redvault_payment_attempts(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CHECK (NOT enabled OR (product_id IS NOT NULL AND expires_at IS NOT NULL)),
  CHECK ((reserved_order_id IS NULL) = (reserved_attempt_id IS NULL))
);
ALTER TABLE private.uba_redvault_live_pilot_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.uba_redvault_live_pilot_policy FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY redvault_live_pilot_policy_no_direct_access
  ON private.uba_redvault_live_pilot_policy AS RESTRICTIVE FOR ALL
  TO anon, authenticated, service_role USING (false) WITH CHECK (false);
INSERT INTO private.uba_redvault_live_pilot_policy(singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE FUNCTION private.configure_uba_redvault_live_pilot(
  p_enabled boolean, p_product_id uuid, p_expires_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM private.uba_redvault_live_pilot_policy WHERE singleton FOR UPDATE;
  IF EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy
      WHERE singleton AND reserved_attempt_id IS NOT NULL)
    AND (p_enabled IS TRUE OR p_product_id IS NOT NULL OR p_expires_at IS NOT NULL) THEN
    RAISE EXCEPTION 'redvault_pilot_consumed_binding_immutable';
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
      AND NOT EXISTS (SELECT 1 FROM public.order_items AS prior_item
        WHERE prior_item.product_id = product.id)
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_product_not_dedicated';
  END IF;
  UPDATE private.uba_redvault_live_pilot_policy
  SET enabled = COALESCE(p_enabled, false),
      product_id = CASE WHEN p_enabled THEN p_product_id WHEN reserved_attempt_id IS NOT NULL THEN product_id ELSE NULL END,
      expires_at = CASE WHEN p_enabled THEN p_expires_at WHEN reserved_attempt_id IS NOT NULL THEN expires_at ELSE NULL END,
      updated_at = pg_catalog.now()
  WHERE singleton;
END;
$$;
ALTER FUNCTION private.configure_uba_redvault_live_pilot(boolean, uuid, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.configure_uba_redvault_live_pilot(boolean, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

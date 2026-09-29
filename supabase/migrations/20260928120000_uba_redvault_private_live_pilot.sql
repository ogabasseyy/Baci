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

CREATE FUNCTION private.enforce_uba_redvault_private_pilot_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  policy private.uba_redvault_live_pilot_policy%ROWTYPE;
  order_row public.orders%ROWTYPE;
  line_count integer;
  product_count integer;
  bound_product uuid;
  unit_count integer;
  unit_price numeric;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('uba_redvault_private_live_pilot_global_cap', 0));
  SELECT * INTO STRICT policy FROM private.uba_redvault_live_pilot_policy
    WHERE singleton FOR SHARE;
  SELECT * INTO order_row FROM public.orders WHERE id = NEW.order_id;
  SELECT count(DISTINCT item.id)::integer, count(DISTINCT item.product_id)::integer,
    min(item.product_id::text)::uuid, COALESCE(sum(item.quantity), 0)::integer,
    min(item.price)::numeric
  INTO line_count, product_count, bound_product, unit_count, unit_price
  FROM public.order_items AS item WHERE item.order_id = NEW.order_id;

  IF policy.enabled IS NOT TRUE
    AND NEW.user_id IS DISTINCT FROM policy.user_id
    AND (policy.product_id IS NULL OR bound_product IS DISTINCT FROM policy.product_id) THEN
    RETURN NEW;
  END IF;
  IF policy.reserved_attempt_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM policy.reserved_order_id THEN
    RAISE EXCEPTION 'redvault_pilot_attempt_cap_reached';
  END IF;
  IF policy.enabled IS NOT TRUE OR policy.expires_at <= pg_catalog.now()
    OR NEW.user_id IS DISTINCT FROM policy.user_id
    OR NEW.merchant_id IS DISTINCT FROM policy.merchant_id
    OR order_row.merchant_id IS DISTINCT FROM policy.merchant_id
    OR order_row.payment_method IS DISTINCT FROM 'uba_redvault'
    OR pg_catalog.upper(order_row.currency) IS DISTINCT FROM 'NGN'
    OR pg_catalog.round(order_row.subtotal * 100)::bigint IS DISTINCT FROM 10000
    OR pg_catalog.round(order_row.discount_amount * 100)::bigint IS DISTINCT FROM 500
    OR COALESCE(pg_catalog.round(order_row.shipping_fee * 100)::bigint, 0) <> 0
    OR COALESCE(pg_catalog.round(order_row.gift_wrapping_fee * 100)::bigint, 0) <> 0
    OR COALESCE(order_row.wallet_amount_used, 0) <> 0
    OR EXISTS (SELECT 1 FROM public.customer_savings_redemptions AS redemption
      WHERE redemption.order_id = order_row.id AND redemption.amount > 0)
    OR line_count <> 1 OR product_count <> 1 OR bound_product IS DISTINCT FROM policy.product_id
    OR unit_count <> 1 OR unit_price IS DISTINCT FROM 100::numeric
    OR EXISTS (SELECT 1 FROM public.order_items AS item
      WHERE item.order_id = NEW.order_id AND item.variant_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'redvault_pilot_order_binding_mismatch';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enforce_uba_redvault_private_pilot_order() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_uba_redvault_private_pilot_order()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER enforce_uba_redvault_private_pilot_order
  BEFORE INSERT ON private.uba_redvault_applications
  FOR EACH ROW EXECUTE FUNCTION private.enforce_uba_redvault_private_pilot_order();

CREATE FUNCTION private.enforce_uba_redvault_private_pilot_attempt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  policy private.uba_redvault_live_pilot_policy%ROWTYPE;
  application private.uba_redvault_applications%ROWTYPE;
  order_row public.orders%ROWTYPE;
  line_count integer;
  distinct_product_count integer;
  line_product uuid;
  line_quantity integer;
  line_price bigint;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('uba_redvault_private_live_pilot_global_cap', 0));
  SELECT * INTO STRICT policy FROM private.uba_redvault_live_pilot_policy
  WHERE singleton FOR UPDATE;
  SELECT * INTO application FROM private.uba_redvault_applications
  WHERE id = NEW.application_id;

  IF policy.enabled IS NOT TRUE
    AND application.user_id IS DISTINCT FROM policy.user_id
    AND (policy.product_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
      WHERE allocation.application_id = application.id AND allocation.product_id = policy.product_id
    )) THEN
    RETURN NEW;
  END IF;
  IF policy.enabled IS NOT TRUE OR policy.expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'redvault_pilot_disabled_or_expired';
  END IF;
  IF policy.reserved_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'redvault_pilot_attempt_cap_reached';
  END IF;

  SELECT * INTO order_row FROM public.orders WHERE id = NEW.order_id;
  SELECT count(DISTINCT allocation.order_item_id)::integer,
    count(DISTINCT allocation.product_id)::integer,
    min(allocation.product_id::text)::uuid,
    COALESCE(sum(DISTINCT item.quantity), 0)::integer,
    min(allocation.unit_price_kobo)::bigint
  INTO line_count, distinct_product_count, line_product, line_quantity, line_price
  FROM private.uba_redvault_line_allocations AS allocation
  JOIN public.order_items AS item ON item.id = allocation.order_item_id
  WHERE allocation.application_id = application.id;
  IF application.order_id IS DISTINCT FROM NEW.order_id
    OR application.user_id IS DISTINCT FROM policy.user_id
    OR application.merchant_id IS DISTINCT FROM policy.merchant_id
    OR NEW.merchant_id IS DISTINCT FROM policy.merchant_id
    OR order_row.merchant_id IS DISTINCT FROM policy.merchant_id
    OR pg_catalog.upper(order_row.currency) IS DISTINCT FROM 'NGN'
    OR order_row.payment_method IS DISTINCT FROM 'uba_redvault'
    OR order_row.payment_status IS DISTINCT FROM 'unpaid'
    OR pg_catalog.round(order_row.subtotal * 100)::bigint IS DISTINCT FROM 10000
    OR pg_catalog.round(order_row.discount_amount * 100)::bigint IS DISTINCT FROM 500
    OR COALESCE(pg_catalog.round(order_row.shipping_fee * 100)::bigint, 0) <> 0
    OR COALESCE(pg_catalog.round(order_row.gift_wrapping_fee * 100)::bigint, 0) <> 0
    OR COALESCE(order_row.wallet_amount_used, 0) <> 0
    OR EXISTS (SELECT 1 FROM public.customer_savings_redemptions AS redemption
      WHERE redemption.order_id = order_row.id AND redemption.amount > 0)
    OR NEW.currency IS DISTINCT FROM 'NGN'
    OR NEW.amount_kobo IS DISTINCT FROM pg_catalog.round(order_row.total * 100)::bigint
    OR application.discount_kobo <> 500
    OR application.eligible_subtotal_kobo <> 10000
    OR line_count <> 1 OR line_quantity <> 1 OR distinct_product_count <> 1
    OR line_product IS DISTINCT FROM policy.product_id OR line_price IS DISTINCT FROM 10000
    OR EXISTS (SELECT 1 FROM public.order_items AS item
      WHERE item.order_id = order_row.id AND item.variant_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'redvault_pilot_order_binding_mismatch';
  END IF;
  UPDATE private.uba_redvault_live_pilot_policy
  SET reserved_order_id = NEW.order_id, reserved_attempt_id = NEW.id, updated_at = pg_catalog.now()
  WHERE singleton AND reserved_attempt_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_pilot_attempt_cap_reached'; END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enforce_uba_redvault_private_pilot_attempt() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_uba_redvault_private_pilot_attempt()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER enforce_uba_redvault_private_pilot_attempt
  BEFORE INSERT ON private.uba_redvault_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION private.enforce_uba_redvault_private_pilot_attempt();

CREATE FUNCTION private.enforce_uba_redvault_private_pilot_expiry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.state IN ('initializing', 'initialized', 'indeterminate')
    AND EXISTS (
      SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
      JOIN private.uba_redvault_applications AS application
        ON application.order_id = NEW.order_id AND application.user_id = policy.user_id
      WHERE policy.reserved_attempt_id = NEW.id
        AND (policy.enabled IS NOT TRUE OR policy.expires_at <= pg_catalog.now())
    ) THEN
    RAISE EXCEPTION 'redvault_pilot_disabled_or_expired';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enforce_uba_redvault_private_pilot_expiry() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_uba_redvault_private_pilot_expiry()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER enforce_uba_redvault_private_pilot_expiry
  BEFORE UPDATE OF state ON private.uba_redvault_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION private.enforce_uba_redvault_private_pilot_expiry();

CREATE FUNCTION private.assert_uba_redvault_private_pilot_active(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  policy private.uba_redvault_live_pilot_policy%ROWTYPE;
  application_id uuid;
  application_user_id uuid;
  application_product_bound boolean;
BEGIN
  SELECT * INTO STRICT policy FROM private.uba_redvault_live_pilot_policy WHERE singleton;
  SELECT application.id, application.user_id,
    EXISTS (SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
      WHERE allocation.application_id = application.id
        AND allocation.product_id = policy.product_id)
  INTO application_id, application_user_id, application_product_bound
  FROM private.uba_redvault_applications AS application
  WHERE application.order_id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_customer_context_required'; END IF;
  IF policy.enabled IS TRUE AND (application_user_id IS DISTINCT FROM policy.user_id
    OR application_product_bound IS NOT TRUE) THEN
    RAISE EXCEPTION 'redvault_pilot_order_binding_mismatch';
  END IF;
  IF application_user_id = policy.user_id OR application_product_bound IS TRUE THEN
    IF policy.reserved_attempt_id IS NOT NULL
      AND p_order_id IS DISTINCT FROM policy.reserved_order_id THEN
      RAISE EXCEPTION 'redvault_pilot_attempt_cap_reached';
    END IF;
  END IF;
  IF (application_user_id = policy.user_id OR application_product_bound IS TRUE)
    AND (policy.enabled IS NOT TRUE OR policy.expires_at <= pg_catalog.now()) THEN
    RAISE EXCEPTION 'redvault_pilot_disabled_or_expired';
  END IF;
END;
$$;
ALTER FUNCTION private.assert_uba_redvault_private_pilot_active(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.assert_uba_redvault_private_pilot_active(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(uuid)
  RENAME TO reserve_storefront_redvault_payment_attempt_v3_pre_pilot;
REVOKE ALL ON FUNCTION public.reserve_storefront_redvault_payment_attempt_v3_pre_pilot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(p_order_id uuid)
RETURNS TABLE (
  attempt_id uuid, reference text, amount_kobo bigint, currency text,
  quote_payload_hash text, state text, bank_code text, authorization_url text,
  paystack_subaccount_code text, platform_fee_kobo bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE receipt record;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('uba_redvault_private_live_pilot_global_cap', 0));
  PERFORM private.assert_uba_redvault_private_pilot_active(p_order_id);
  SELECT * INTO STRICT receipt FROM
    public.reserve_storefront_redvault_payment_attempt_v3_pre_pilot(p_order_id);
  RETURN QUERY SELECT receipt.attempt_id, receipt.reference, receipt.amount_kobo,
    receipt.currency, receipt.quote_payload_hash, receipt.state, receipt.bank_code,
    receipt.authorization_url, receipt.paystack_subaccount_code, receipt.platform_fee_kobo;
END;
$$;
ALTER FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(uuid)
  TO authenticated;

ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)
  RENAME TO claim_redvault_initialization_v3_pre_pilot;
REVOKE ALL ON FUNCTION public.claim_redvault_initialization_v3_pre_pilot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(p_attempt_id uuid)
RETURNS TABLE (
  attempt_id uuid, reference text, amount_kobo bigint, currency text,
  quote_payload_hash text, state text, bank_code text, authorization_url text,
  initialization_claimed boolean, paystack_subaccount_code text, platform_fee_kobo bigint,
  split_retained_shipping_kobo bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE attempt_order_id uuid; receipt record;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  SELECT order_id INTO STRICT attempt_order_id
  FROM private.uba_redvault_payment_attempts WHERE id = p_attempt_id;
  PERFORM private.assert_uba_redvault_private_pilot_active(attempt_order_id);
  SELECT * INTO STRICT receipt FROM
    public.claim_redvault_initialization_v3_pre_pilot(p_attempt_id);
  RETURN QUERY SELECT receipt.attempt_id, receipt.reference, receipt.amount_kobo,
    receipt.currency, receipt.quote_payload_hash, receipt.state, receipt.bank_code,
    receipt.authorization_url, receipt.initialization_claimed,
    receipt.paystack_subaccount_code, receipt.platform_fee_kobo,
    receipt.split_retained_shipping_kobo;
END;
$$;
ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)
  TO authenticated;

CREATE FUNCTION private.block_uba_redvault_pilot_postapproval_fulfillment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(NEW.wallet_amount_used, 0) <> 0 AND EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
    JOIN private.uba_redvault_applications AS application ON application.order_id = OLD.id
    WHERE (policy.enabled IS TRUE OR policy.reserved_order_id = OLD.id)
      AND (application.user_id = policy.user_id OR EXISTS (
        SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
        WHERE allocation.application_id = application.id
          AND allocation.product_id = policy.product_id
      ))
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_wallet_or_savings_credit_blocked';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
    JOIN private.uba_redvault_applications AS application
      ON application.order_id = OLD.id AND application.user_id = policy.user_id
    JOIN private.uba_redvault_payment_attempts AS attempt
      ON attempt.order_id = OLD.id AND attempt.state = 'approved'
    WHERE policy.reserved_order_id = OLD.id
  ) AND (
    NEW.shipping_status IS DISTINCT FROM OLD.shipping_status
    OR NEW.tracking_number IS DISTINCT FROM OLD.tracking_number
    OR NEW.shipping_provider IS DISTINCT FROM OLD.shipping_provider
    OR NEW.shipment_id IS DISTINCT FROM OLD.shipment_id
    OR NEW.shipped_at IS DISTINCT FROM OLD.shipped_at
    OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at
    OR NEW.fulfillment_details IS DISTINCT FROM OLD.fulfillment_details
    OR pg_catalog.to_jsonb(NEW)->'shipment_booking_lock_token'
      IS DISTINCT FROM pg_catalog.to_jsonb(OLD)->'shipment_booking_lock_token'
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_physical_fulfillment_blocked';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.block_uba_redvault_pilot_postapproval_fulfillment() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.block_uba_redvault_pilot_postapproval_fulfillment()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER block_uba_redvault_pilot_postapproval_fulfillment
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.block_uba_redvault_pilot_postapproval_fulfillment();

CREATE FUNCTION private.block_uba_redvault_pilot_savings_redemption()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.amount > 0 AND EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
    JOIN private.uba_redvault_applications AS application
      ON application.order_id = NEW.order_id
    WHERE (policy.enabled IS TRUE OR policy.reserved_attempt_id IS NOT NULL)
      AND (application.user_id = policy.user_id OR EXISTS (
        SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
        WHERE allocation.application_id = application.id
          AND allocation.product_id = policy.product_id
      ))
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_wallet_or_savings_credit_blocked';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.block_uba_redvault_pilot_savings_redemption() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.block_uba_redvault_pilot_savings_redemption()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER block_uba_redvault_pilot_savings_redemption
  BEFORE INSERT OR UPDATE ON public.customer_savings_redemptions
  FOR EACH ROW EXECUTE FUNCTION private.block_uba_redvault_pilot_savings_redemption();

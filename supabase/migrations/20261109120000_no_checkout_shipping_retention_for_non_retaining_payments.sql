-- Do not stamp customer_checkout shipping retention for payment methods that cannot
-- retain shipping (credit_direct, pod, cash, manual); let existing mis-stamped
-- orders rebind to the merchant wallet. Prod order ORD-261106-00P5-H (2026-11-09).

-- Credit Direct (BNPL), pay-on-delivery, cash and manual payments never route the
-- shipping fee to Baci, so checkout must not stamp customer_checkout retention
-- for them. Mirrors GIGL_CHECKOUT_PAYMENT_METHODS_WITHOUT_RETENTION in
-- apps/web/src/lib/shipping/assert-gigl-customer-checkout-prepaid.ts.
CREATE OR REPLACE FUNCTION private.is_non_retaining_checkout_payment_method(p_method text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.lower(pg_catalog.btrim(COALESCE(p_method, ''))) IN (
    'pod', 'pay_on_delivery', 'credit_direct', 'credit-direct',
    'manual', 'manual_payment', 'cash'
  );
$$;
REVOKE ALL ON FUNCTION private.is_non_retaining_checkout_payment_method(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.stamp_gigl_order_economics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider text;
  v_provider_cost numeric;
  v_platform_margin numeric;
  v_pricing_version text;
  v_price numeric;
BEGIN
  IF NEW.shipping_funding_source IS NOT NULL
     AND NEW.shipping_funding_source NOT IN ('customer_checkout', 'merchant_wallet') THEN
    RAISE EXCEPTION 'Invalid shipping funding source' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.shipping_funding_source = 'customer_checkout'
     AND COALESCE(OLD.shipping_platform_retained_amount, 0) > 0
     AND NEW.shipping_funding_source = 'merchant_wallet'
     AND NOT private.is_non_retaining_checkout_payment_method(OLD.payment_method) THEN
    RAISE EXCEPTION 'customer_checkout_wallet_rebind_forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- Self-fulfillment before settlement must drop checkout retention so payment
  -- settlement does not withhold GIGL shipping for a merchant-delivered order.
  IF TG_OP = 'UPDATE'
     AND NEW.fulfillment_type = 'self'
     AND COALESCE(OLD.fulfillment_type, '') IS DISTINCT FROM 'self'
     AND NEW.selected_quote_id IS NULL
     AND NEW.shipping_status IN ('shipped', 'delivered') THEN
    NEW.shipping_funding_source := NULL;
    NEW.shipping_provider_cost := NULL;
    NEW.shipping_platform_margin := NULL;
    NEW.shipping_pricing_version := NULL;
    NEW.shipping_platform_retained_amount := 0;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.shipping_funding_source = 'customer_checkout'
     AND COALESCE(OLD.shipping_platform_retained_amount, 0) > 0
     AND NOT private.is_non_retaining_checkout_payment_method(OLD.payment_method) THEN
    NEW.shipping_funding_source := 'customer_checkout';
    IF COALESCE(NEW.fulfillment_type, '') IS DISTINCT FROM 'self' THEN
      NEW.shipping_provider := 'GIGL';
    END IF;
    NEW.shipping_provider_cost := OLD.shipping_provider_cost;
    NEW.shipping_platform_margin := OLD.shipping_platform_margin;
    NEW.shipping_pricing_version := OLD.shipping_pricing_version;
    NEW.shipping_platform_retained_amount := OLD.shipping_platform_retained_amount;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.shipping_funding_source = 'merchant_wallet'
     AND NEW.selected_quote_id IS NOT NULL THEN
    NEW.shipping_funding_source := 'merchant_wallet';
  END IF;

  IF NEW.selected_quote_id IS NULL THEN
    NEW.shipping_funding_source := NULL;
    NEW.shipping_provider_cost := NULL;
    NEW.shipping_platform_margin := NULL;
    NEW.shipping_pricing_version := NULL;
    NEW.shipping_platform_retained_amount := 0;
    RETURN NEW;
  END IF;

  SELECT sq.provider, sq.provider_cost, sq.platform_margin,
         sq.pricing_version, sq.price
    INTO v_provider, v_provider_cost, v_platform_margin, v_pricing_version, v_price
    FROM public.shipping_quotes sq
   WHERE sq.id = NEW.selected_quote_id
     AND sq.merchant_id = NEW.merchant_id
   LIMIT 1;
  IF NOT FOUND
     OR pg_catalog.upper(pg_catalog.btrim(COALESCE(v_provider, ''))) <> 'GIGL'
     OR v_pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1' THEN
    NEW.shipping_funding_source := NULL;
    NEW.shipping_provider_cost := NULL;
    NEW.shipping_platform_margin := NULL;
    NEW.shipping_pricing_version := NULL;
    NEW.shipping_platform_retained_amount := 0;
    RETURN NEW;
  END IF;
  IF NEW.shipping_funding_source = 'customer_checkout'
     AND private.is_non_retaining_checkout_payment_method(NEW.payment_method) THEN
    -- Mis-stamped (or client-supplied) checkout funding on a payment that
    -- cannot retain shipping: leave it for the merchant wallet at booking.
    NEW.shipping_funding_source := NULL;
  END IF;
  IF NEW.shipping_funding_source IS NULL
     AND NOT private.is_non_retaining_checkout_payment_method(NEW.payment_method) THEN
    NEW.shipping_funding_source := 'customer_checkout';
  END IF;
  NEW.shipping_provider_cost := v_provider_cost;
  NEW.shipping_platform_margin := v_platform_margin;
  NEW.shipping_pricing_version := 'gigl_platform_margin_v1';
  NEW.shipping_platform_retained_amount := CASE
    WHEN NEW.shipping_funding_source = 'customer_checkout' THEN v_price
    ELSE 0
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.stamp_gigl_order_economics() FROM PUBLIC;

-- Re-evaluate when the payment method is set or changed after the quote.
DROP TRIGGER IF EXISTS stamp_gigl_order_economics ON public.orders;
CREATE TRIGGER stamp_gigl_order_economics
  BEFORE INSERT OR UPDATE OF selected_quote_id, shipping_funding_source,
    shipping_provider_cost, shipping_platform_margin,
    shipping_platform_retained_amount, shipping_pricing_version, shipping_provider,
    payment_status, payment_method
  ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.stamp_gigl_order_economics();

-- Payments that cannot retain shipping hold none, whatever a stale settlement
-- or stamp says; this lets the admin wallet bind rebind mis-stamped orders.
CREATE OR REPLACE FUNCTION private.order_settled_gigl_retained_amount(
  p_order_id uuid,
  p_merchant_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH settlement_retained AS (
    SELECT COALESCE(SUM(
      GREATEST(
        COALESCE((settlement.metadata ->> 'retained_shipping_amount')::numeric, 0),
        0
      )
    ), 0) AS amount
    FROM public.merchant_settlements AS settlement
    WHERE settlement.source_type = 'order'
      AND settlement.source_id = p_order_id
      AND settlement.merchant_id = p_merchant_id
      AND settlement.status IS DISTINCT FROM 'cancelled'
  ),
  order_retention AS (
    SELECT
      o.shipping_funding_source,
      GREATEST(COALESCE(o.shipping_platform_retained_amount, 0), 0) AS stamped_retained
    FROM public.orders AS o
    WHERE o.id = p_order_id
      AND o.merchant_id = p_merchant_id
  ),
  internal_credit AS (
    SELECT GREATEST(
      COALESCE((
        SELECT SUM(GREATEST(COALESCE(t.amount, 0), 0))
        FROM public.transactions AS t
        WHERE t.merchant_id = p_merchant_id
          AND t.order_id = p_order_id
          AND t.status = 'completed'
          AND lower(btrim(COALESCE(t.gateway, ''))) = ANY (
            ARRAY['wallet', 'savings', 'store_credit']::text[]
          )
      ), 0),
      COALESCE((
        SELECT SUM(GREATEST(COALESCE(w.amount, 0), 0))
        FROM public.customer_wallet_transactions AS w
        WHERE w.merchant_id = p_merchant_id
          AND w.source_type = 'order_redemption'
          AND w.source_id = p_order_id
          AND w.status = 'completed'
      ), 0)
      + COALESCE((
        SELECT SUM(GREATEST(COALESCE(s.amount, 0), 0))
        FROM public.customer_savings_redemptions AS s
        WHERE s.merchant_id = p_merchant_id
          AND s.order_id = p_order_id
          AND s.metadata->>'reversed_at' IS NULL
      ), 0)
    ) AS amount
  )
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.orders AS po
    WHERE po.id = p_order_id
      AND po.merchant_id = p_merchant_id
      AND private.is_non_retaining_checkout_payment_method(po.payment_method)
  ) THEN 0::numeric ELSE GREATEST(
    (SELECT amount FROM settlement_retained),
    CASE
      WHEN (SELECT shipping_funding_source FROM order_retention)
           IS NOT DISTINCT FROM 'customer_checkout'
        THEN LEAST(
          (SELECT stamped_retained FROM order_retention),
          (SELECT amount FROM internal_credit)
        )
      ELSE 0
    END
  ) END;
$$;
REVOKE ALL ON FUNCTION private.order_settled_gigl_retained_amount(uuid, uuid)
  FROM PUBLIC;

-- The shipping wallet balance shown to merchants must be the spendable figure
-- reserve_merchant_shipping_charge uses (20261103084503): balance minus Paystack
-- direct-split exposure, which is not Baci-held money. Otherwise the panel
-- showed "From your wallet" and booking then failed as insufficient.
CREATE OR REPLACE FUNCTION public.get_merchant_shipping_wallet_balance(
  p_merchant_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id_required' USING ERRCODE = '22023';
  END IF;
  IF (SELECT auth.uid()) IS NULL OR NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill'
  ) THEN
    RAISE EXCEPTION 'merchant_shipping_wallet_balance_forbidden'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(
    (
      SELECT GREATEST(
        wallet.available_balance
          - private.merchant_wallet_direct_settled_exposure(wallet.id),
        0
      )
      FROM public.merchant_wallets AS wallet
      WHERE wallet.merchant_id = p_merchant_id
    ),
    0
  );
END;
$$;

ALTER FUNCTION public.get_merchant_shipping_wallet_balance(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_merchant_shipping_wallet_balance(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_merchant_shipping_wallet_balance(uuid)
  TO authenticated;

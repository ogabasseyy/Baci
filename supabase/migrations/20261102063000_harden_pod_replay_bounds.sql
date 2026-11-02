-- POD aliases preserve an already accepted payment method, and guest replay
-- probes must enforce the checkout key's existing 16-byte minimum.
CREATE OR REPLACE FUNCTION private.enforce_order_pay_on_delivery_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_enabled boolean;
BEGIN
  IF NOT private.is_pay_on_delivery_method(NEW.payment_method) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.merchant_id IS NOT DISTINCT FROM OLD.merchant_id
    AND private.is_pay_on_delivery_method(OLD.payment_method) THEN
    RETURN NEW;
  END IF;
  SELECT settings.pay_on_delivery_enabled INTO v_enabled
  FROM public.merchant_feature_settings settings
  WHERE settings.merchant_id = NEW.merchant_id
  FOR SHARE;
  IF v_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'pay_on_delivery_disabled' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_storefront_pod_order_idempotency_hash(
  p_merchant_id uuid,
  p_checkout_idempotency_key text,
  p_checkout_request_hash text
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders AS o
    WHERE p_merchant_id IS NOT NULL
      AND p_checkout_idempotency_key IS NOT NULL
      AND p_checkout_request_hash IS NOT NULL
      AND octet_length(trim(p_checkout_idempotency_key)) BETWEEN 16 AND 128
      AND octet_length(trim(p_checkout_request_hash)) = 64
      AND o.merchant_id = p_merchant_id
      AND o.checkout_idempotency_key = trim(p_checkout_idempotency_key)
      AND o.checkout_request_hash = trim(p_checkout_request_hash)
      AND private.is_pay_on_delivery_method(o.payment_method)
  );
$$;

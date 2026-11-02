-- Apply the merchant's POD policy at the atomic persistence boundary. Every
-- order creator and payment-mode switch must pass this invariant, including
-- permitted direct RPC calls; an API-only check cannot enforce it.
CREATE FUNCTION private.enforce_order_pay_on_delivery_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_enabled boolean;
BEGIN
  IF lower(btrim(coalesce(NEW.payment_method,''))) NOT IN ('pod','pay_on_delivery') THEN
    RETURN NEW;
  END IF;
  -- An already accepted order remains replayable after a setting change.
  -- Reassigning its merchant or switching a payment method needs fresh approval.
  IF TG_OP = 'UPDATE' AND NEW.merchant_id IS NOT DISTINCT FROM OLD.merchant_id
    AND NEW.payment_method IS NOT DISTINCT FROM OLD.payment_method THEN
    RETURN NEW;
  END IF;
  -- Serialize admission against a concurrent settings update through commit.
  -- A missing row, NULL, or false is never permission to accept POD.
  SELECT settings.pay_on_delivery_enabled INTO v_enabled
  FROM public.merchant_feature_settings settings
  WHERE settings.merchant_id=NEW.merchant_id
  FOR SHARE;
  IF v_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'pay_on_delivery_disabled' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enforce_order_pay_on_delivery_policy() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_order_pay_on_delivery_policy()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER orders_enforce_pay_on_delivery_policy
BEFORE INSERT OR UPDATE OF merchant_id,payment_method ON public.orders
FOR EACH ROW EXECUTE FUNCTION private.enforce_order_pay_on_delivery_policy();

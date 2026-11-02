-- Keep the initial POD trigger at the final whitespace and alias semantics.
-- This standalone body is also safe if applied after the later POD migrations.
CREATE OR REPLACE FUNCTION private.enforce_order_pay_on_delivery_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_enabled boolean;
  v_whitespace constant text := U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF lower(btrim(coalesce(NEW.payment_method, ''), v_whitespace)) NOT IN ('pod', 'pay_on_delivery') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.merchant_id IS NOT DISTINCT FROM OLD.merchant_id
    AND lower(btrim(coalesce(OLD.payment_method, ''), v_whitespace)) IN ('pod', 'pay_on_delivery') THEN
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

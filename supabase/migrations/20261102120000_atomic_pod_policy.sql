-- Install the complete POD boundary as one PostgreSQL statement. Individual
-- psql statements are transactional even for sequential migration appliers.
DO $install$
BEGIN
  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION private.is_pay_on_delivery_method(p_method text)
    RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $body$
      SELECT lower(btrim(coalesce(p_method, ''),
        U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
      )) IN ('pod', 'pay_on_delivery');
    $body$
  $ddl$;
  EXECUTE 'REVOKE ALL ON FUNCTION private.is_pay_on_delivery_method(text) FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION private.enforce_order_pay_on_delivery_policy()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $body$
    DECLARE v_enabled boolean;
    BEGIN
      IF NOT private.is_pay_on_delivery_method(NEW.payment_method) THEN RETURN NEW; END IF;
      IF TG_OP = 'UPDATE' AND NEW.merchant_id IS NOT DISTINCT FROM OLD.merchant_id
         AND private.is_pay_on_delivery_method(OLD.payment_method) THEN RETURN NEW; END IF;
      SELECT settings.pay_on_delivery_enabled INTO v_enabled
      FROM public.merchant_feature_settings settings
      WHERE settings.merchant_id = NEW.merchant_id FOR SHARE;
      IF v_enabled IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'pay_on_delivery_disabled' USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END;
    $body$
  $ddl$;
  EXECUTE 'ALTER FUNCTION private.enforce_order_pay_on_delivery_policy() OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION private.enforce_order_pay_on_delivery_policy() FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE $ddl$
    CREATE OR REPLACE TRIGGER orders_enforce_pay_on_delivery_policy
    BEFORE INSERT OR UPDATE OF merchant_id, payment_method ON public.orders
    FOR EACH ROW EXECUTE FUNCTION private.enforce_order_pay_on_delivery_policy()
  $ddl$;
  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION public.is_storefront_pod_order_idempotency_hash(
      p_merchant_id uuid, p_checkout_idempotency_key text, p_checkout_request_hash text
    ) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $body$
      SELECT EXISTS (
        SELECT 1 FROM public.orders AS o
        WHERE p_merchant_id IS NOT NULL
          AND coalesce(auth.jwt() ->> 'storefront_order_context', '') = 'route'
          AND coalesce(auth.jwt() ->> 'storefront_order_merchant_id', '') = p_merchant_id::text
          AND octet_length(trim(p_checkout_idempotency_key)) BETWEEN 16 AND 128
          AND octet_length(trim(p_checkout_request_hash)) = 64
          AND o.merchant_id = p_merchant_id
          AND o.checkout_idempotency_key = trim(p_checkout_idempotency_key)
          AND o.checkout_request_hash = trim(p_checkout_request_hash)
          AND private.is_pay_on_delivery_method(o.payment_method)
      );
    $body$
  $ddl$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.is_storefront_pod_order_idempotency_hash(uuid,text,text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_storefront_pod_order_idempotency_hash(uuid,text,text) TO authenticated';
END;
$install$;

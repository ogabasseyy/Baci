-- Preserve the wrapper's replay context, argument order, and privilege profile
-- while naming its complete return contract instead of using SELECT *.
DO $patch$
DECLARE
  target_oid oid;
  definition text;
  old_projection text := $old$  SELECT *
  FROM private.create_storefront_order_unchecked($old$;
  new_projection text := $new$  SELECT delegated.id, delegated.order_number, delegated.tracking_token,
    delegated.subtotal, delegated.shipping_fee, delegated.discount_amount,
    delegated.tax_amount, delegated.total, delegated.customer_id,
    delegated.customer_email, delegated.customer_name, delegated.customer_phone,
    delegated.payment_status, delegated.shipping_status, delegated.payment_method,
    delegated.shipping_address, delegated.merchant_id, delegated.tax_basis,
    delegated.gift_wrapping_fee, delegated.idempotency_replayed
  FROM private.create_storefront_order_unchecked($new$;
  old_end text := $old$    p_checkout_request_hash
  );$old$;
  new_end text := $new$    p_checkout_request_hash
  ) AS delegated;$new$;
BEGIN
  SELECT p.oid INTO STRICT target_oid
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private' AND p.proname = 'create_storefront_order' AND p.pronargs = 24;
  definition := replace(pg_catalog.pg_get_functiondef(target_oid), E'\r\n', E'\n');
  IF (length(definition) - length(replace(definition, old_projection, ''))) / length(old_projection) <> 1
    OR (length(definition) - length(replace(definition, old_end, ''))) / length(old_end) <> 1 THEN
    RAISE EXCEPTION 'storefront order delegation source mismatch';
  END IF;
  EXECUTE replace(replace(definition, old_projection, new_projection), old_end, new_end);
END $patch$;

-- Recovery hardening: diagnosable signing config and lookup indexes.
--
-- 1. The context fingerprint helper read vault.decrypted_secrets directly, so a
--    database without the vault extension (or without the key) failed deep
--    inside the query with an opaque error. The helper now guards the vault
--    lookup and raises a named configuration error when the signing secret is
--    absent, mirroring the shipping-quote proof verifier. Fingerprint values
--    are unchanged: same canonical payload, same HMAC construction.
-- 2. The previews merchant foreign key and the hourly retention sweep filter
--    had no supporting indexes; add them so merchant deletion and the sweep
--    do not seq-scan the previews table.
CREATE OR REPLACE FUNCTION private.customer_checkout_shipping_recovery_fingerprint(p_order_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_secret text; v_payload text;
BEGIN
  IF pg_catalog.to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
      INTO v_secret USING 'service_role_key';
  END IF;
  IF v_secret IS NULL OR pg_catalog.btrim(v_secret) = '' THEN
    RAISE EXCEPTION 'shipping_recovery_signing_unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.jsonb_build_object('order_id', o.id, 'merchant_id', o.merchant_id,
      'shipping_fee', o.shipping_fee, 'items', (SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', i.id, 'item', to_jsonb(i))
        ORDER BY i.id) FROM public.order_items i WHERE i.order_id = o.id))::text
    INTO v_payload
    FROM public.orders o JOIN public.merchants m ON m.id = o.merchant_id
    WHERE o.id = p_order_id;
  -- Preserve the historical NULL contract for unknown orders: the caller
  -- treats a NULL fingerprint as a mismatch. Only a missing signing secret
  -- raises, so misconfiguration fails with a diagnosable message.
  IF v_payload IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN pg_catalog.encode(
    extensions.hmac('baci:customer-checkout-shipping-recovery:v1:' || v_payload, v_secret, 'sha256'), 'hex');
END;
$$;
CREATE INDEX IF NOT EXISTS customer_checkout_shipping_recovery_previews_merchant_id_idx
  ON private.customer_checkout_shipping_recovery_previews (merchant_id);
CREATE INDEX IF NOT EXISTS customer_checkout_shipping_recovery_previews_unconfirmed_expiry_idx
  ON private.customer_checkout_shipping_recovery_previews (expires_at)
  WHERE confirmed_at IS NULL;

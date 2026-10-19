-- Recovery confirm hardening: scalar-safe merge, redaction-proof retry, sender-scoped fingerprint, explicit access policy.
--
-- 1. Legacy orders may store shipping_address as a JSON scalar (string). The
--    confirmation merge (`COALESCE(address,'{}') || receiver`) turned that
--    scalar plus the receiver object into an array, leaving the recovered
--    order unbookable. Non-object stored values now coerce to {} before merge.
-- 2. The already-confirmed fast path compared the live order address against
--    the preview's quoted receiver, but retention redacts confirmed previews'
--    quote payloads after 90 days, so late retries of a committed
--    confirmation misreported shipping_recovery_stale. The committed link is
--    the order's selected_quote_id pointing at the preview id; that survives
--    redaction and alone proves this preview produced the live quote.
-- 3. The fingerprint hashed the entire merchant row, so unrelated merchant
--    edits (logo, settings, updated_at) during the preview window forced
--    shipping_recovery_stale. The merchant projection is now sender inputs
--    plus the owning user_id (an owner change still invalidates); quote and
--    item inputs are unchanged. Fingerprint values change: in-flight previews
--    go stale (fail-closed; five-minute TTL).
-- 4. The previews table enabled RLS without an explicit policy. Access stays
--    deny-by-default (restrictive, all roles, USING/CHECK false), matching
--    the private redvault runtime tables, so the authorization model is
--    explicit if grants ever change.
DROP POLICY IF EXISTS customer_checkout_shipping_recovery_no_direct_access
  ON private.customer_checkout_shipping_recovery_previews;
CREATE POLICY customer_checkout_shipping_recovery_no_direct_access
  ON private.customer_checkout_shipping_recovery_previews
  AS RESTRICTIVE FOR ALL TO anon, authenticated, service_role USING (false) WITH CHECK (false);
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
  -- Canonical payload: full order row, sender-plus-ownership merchant
  -- projection (only sender inputs feed the carrier quote; user_id binds the
  -- owning account, so an owner change still invalidates), the selected
  -- quote, and per-item product fields. Same HMAC construction as before.
  SELECT pg_catalog.jsonb_build_object('order',pg_catalog.to_jsonb(o),
      'merchant',pg_catalog.jsonb_build_object('id',m.id,'user_id',m.user_id,
        'business_name',m.business_name,'business_address',m.business_address,
        'phone',m.phone,'registered_address',m.registered_address,'state_code',m.state_code),
      'quote',(SELECT pg_catalog.to_jsonb(q) FROM public.shipping_quotes q WHERE q.id=o.selected_quote_id AND q.merchant_id=o.merchant_id),
      'items',COALESCE((SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('item',pg_catalog.to_jsonb(i),'product',pg_catalog.jsonb_build_object('id',p.id,'weight_value',p.weight_value,'weight_unit',p.weight_unit,'dimensions',p.dimensions,'commodity_code',p.commodity_code))
        ORDER BY i.id) FROM public.order_items i LEFT JOIN public.products p ON p.id=i.product_id
        WHERE i.order_id=o.id),'[]'::jsonb))::text
    INTO v_payload
    FROM public.orders o JOIN public.merchants m ON m.id = o.merchant_id
    WHERE o.id = p_order_id;
  IF v_payload IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN pg_catalog.encode(extensions.hmac('baci:checkout-shipping-recovery:v1:' || v_payload, v_secret, 'sha256'), 'hex');
END;
$$;
CREATE OR REPLACE FUNCTION public.confirm_customer_checkout_shipping_recovery(
  p_order_id uuid, p_preview_id uuid, p_confirm_destination boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.orders%ROWTYPE;
  v_preview private.customer_checkout_shipping_recovery_previews%ROWTYPE; v_quote_id uuid;
  v_existing jsonb;
BEGIN
  IF p_confirm_destination IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'destination_confirmation_required' USING ERRCODE='22023';
  END IF;
  v_order := private.assert_customer_checkout_shipping_recovery(p_order_id);
  -- Lock the order before its preview consistently with prepare/refund/booking.
  SELECT * INTO v_preview FROM private.customer_checkout_shipping_recovery_previews
    WHERE id=p_preview_id AND order_id=p_order_id AND merchant_id=v_order.merchant_id
      AND actor_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  IF v_preview.confirmed_at IS NOT NULL THEN
    -- The live quote link survives audit redaction; the quoted-receiver
    -- comparison below does not (redacted quotes lose quote_request). A
    -- selected_quote_id pointing at this preview proves this confirmation
    -- already committed, so the retry stays idempotent past redaction.
    IF v_order.selected_quote_id=v_preview.id THEN
      RETURN pg_catalog.jsonb_build_object('quoteId',v_preview.id,'confirmed',true);
    END IF;
    RAISE EXCEPTION 'shipping_recovery_stale' USING ERRCODE='40001';
  END IF;
  IF v_preview.expires_at<=now() THEN
    RAISE EXCEPTION 'shipping_recovery_expired' USING ERRCODE='22023';
  END IF;
  IF v_preview.fingerprint IS DISTINCT FROM private.customer_checkout_shipping_recovery_fingerprint(p_order_id) THEN
    RAISE EXCEPTION 'shipping_recovery_stale' USING ERRCODE='40001';
  END IF;
  IF (v_preview.quote->>'price')::numeric IS DISTINCT FROM v_order.shipping_fee THEN
    RAISE EXCEPTION 'shipping_recovery_price_changed' USING ERRCODE='22023';
  END IF;
  -- Explicit operator confirmation, never inferred from legacy quote coordinates.
  -- A scalar legacy address (stored JSON string) would merge into an array
  -- with `jsonb ||`; coerce non-objects to {} so confirmation always writes
  -- a bookable address object.
  v_existing := COALESCE(v_order.shipping_address,'{}'::jsonb);
  IF pg_catalog.jsonb_typeof(v_existing) IS DISTINCT FROM 'object' THEN
    v_existing := '{}'::jsonb;
  END IF;
  UPDATE public.orders SET shipping_address=v_existing
      || (v_preview.quote->'quote_request'->'receiver'), updated_at=now()
    WHERE id=p_order_id AND merchant_id=v_order.merchant_id;
  -- Reuse the existing validated GIGL writer, which retains paid checkout economics.
  -- The private preview was already proof-verified and is inaccessible to clients.
  v_quote_id := public.persist_refreshed_order_shipping_quote(p_order_id,v_preview.quote);
  UPDATE private.customer_checkout_shipping_recovery_previews SET confirmed_at=now()
    WHERE id=p_preview_id;
  -- Private preview stores actor, original destination, replacement and confirmation time as audit.
  RETURN pg_catalog.jsonb_build_object('quoteId',v_quote_id,'confirmed',true);
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_customer_checkout_shipping_recovery(uuid,uuid,boolean)
  FROM PUBLIC, anon, authenticated, service_role;

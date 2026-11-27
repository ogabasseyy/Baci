-- Acquire catalog rows before customer identity locks so checkout and late
-- payment reinstatement share one global lock order.
CREATE OR REPLACE FUNCTION private.create_storefront_order(
  p_merchant_id uuid,
  p_customer_email text,
  p_customer_name text,
  p_items jsonb,
  p_customer_phone text DEFAULT NULL::text,
  p_shipping_fee numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_tax_amount numeric DEFAULT 0,
  p_payment_method text DEFAULT 'card'::text,
  p_payment_status text DEFAULT 'unpaid'::text,
  p_shipping_status text DEFAULT 'pending'::text,
  p_shipping_address jsonb DEFAULT NULL::jsonb,
  p_source text DEFAULT 'online_store'::text,
  p_notes text DEFAULT NULL::text,
  p_ad_tracking jsonb DEFAULT NULL::jsonb,
  p_selected_quote_id uuid DEFAULT NULL::uuid,
  p_shipping_provider text DEFAULT NULL::text,
  p_tracking_number text DEFAULT NULL::text,
  p_user_id uuid DEFAULT NULL::uuid,
  p_tax_basis text DEFAULT 'exclusive'::text,
  p_gift_wrapping_fee numeric DEFAULT 0,
  p_expected_total numeric DEFAULT NULL::numeric,
  p_checkout_idempotency_key text DEFAULT NULL::text,
  p_checkout_request_hash text DEFAULT NULL::text
)
RETURNS TABLE(
  id uuid, order_number text, tracking_token text, subtotal numeric,
  shipping_fee numeric, discount_amount numeric, tax_amount numeric,
  total numeric, customer_id uuid, customer_email text, customer_name text,
  customer_phone text, payment_status text, shipping_status text,
  payment_method text, shipping_address jsonb, merchant_id uuid,
  tax_basis text, gift_wrapping_fee numeric, idempotency_replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Keep the catalog-before-customer lock order shared with late-payment
  -- reinstatement, which locks these rows before acquiring identity locks.
  PERFORM p.id FROM public.products p WHERE p.merchant_id = p_merchant_id AND p.id IN (
    SELECT coalesce(nullif(item->>'product_id', ''), nullif(item->>'productId', ''), nullif(item->>'id', ''))::uuid
    FROM jsonb_array_elements(p_items) item
  ) ORDER BY p.id FOR UPDATE;
  PERFORM v.id
  FROM public.product_variants v
  JOIN public.products p ON p.id = v.product_id AND p.merchant_id = v.merchant_id
  WHERE p.merchant_id = p_merchant_id
    AND v.id IN (
      SELECT nullif(item->>'variant_id', '')::uuid
      FROM jsonb_array_elements(p_items) item
    )
  ORDER BY v.id FOR UPDATE OF v;
  PERFORM offer.id
  FROM public.product_offers offer
  JOIN public.products p ON p.id = offer.product_id AND p.merchant_id = offer.merchant_id
  WHERE p.merchant_id = p_merchant_id
    AND p.id IN (
      SELECT coalesce(nullif(item->>'product_id', ''), nullif(item->>'productId', ''), nullif(item->>'id', ''))::uuid
      FROM jsonb_array_elements(p_items) item
    )
  ORDER BY offer.id FOR UPDATE OF offer;

  PERFORM private.lock_storefront_order_entrypoint_identity(
    p_merchant_id, p_user_id, p_customer_email, p_customer_phone
  );

  PERFORM pg_catalog.set_config(
    'baci.storefront_order_replay_context', 'create_storefront_order', true
  );

  RETURN QUERY
  SELECT *
  FROM private.create_storefront_order_unchecked(
    p_merchant_id, p_customer_email, p_customer_name, p_items,
    p_customer_phone, p_shipping_fee, p_discount_amount, p_tax_amount,
    p_payment_method, p_payment_status, p_shipping_status, p_shipping_address,
    p_source, p_notes, p_ad_tracking, p_selected_quote_id,
    p_shipping_provider, p_tracking_number, p_user_id, p_tax_basis,
    p_gift_wrapping_fee, p_expected_total, p_checkout_idempotency_key,
    p_checkout_request_hash
  );
END;
$$;

ALTER FUNCTION private.create_storefront_order(
  uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text, text,
  jsonb, text, text, jsonb, uuid, text, text, uuid, text, numeric, numeric,
  text, text
) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION private.create_storefront_order(
  uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text, text,
  jsonb, text, text, jsonb, uuid, text, text, uuid, text, numeric, numeric,
  text, text
) TO anon, authenticated, service_role;

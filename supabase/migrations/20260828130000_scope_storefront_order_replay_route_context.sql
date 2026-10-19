-- Keep the replay guard on the idempotent create path only.  The pending-order
-- reuse and payment-finalization RPCs also update keyed orders while they are
-- still pending, but they already have their own authorization boundaries and
-- must not be mistaken for an idempotent create replay.

ALTER FUNCTION private.create_storefront_order(
  uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text,
  text, jsonb, text, text, jsonb, uuid, text, text, uuid, text, numeric,
  numeric, text, text
) RENAME TO create_storefront_order_unchecked;

REVOKE ALL ON FUNCTION private.create_storefront_order_unchecked(
  uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text,
  text, jsonb, text, text, jsonb, uuid, text, text, uuid, text, numeric,
  numeric, text, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.create_storefront_order(
  p_merchant_id UUID,
  p_customer_email TEXT,
  p_customer_name TEXT,
  p_items JSONB,
  p_customer_phone TEXT DEFAULT NULL,
  p_shipping_fee NUMERIC DEFAULT 0,
  p_discount_amount NUMERIC DEFAULT 0,
  p_tax_amount NUMERIC DEFAULT 0,
  p_payment_method TEXT DEFAULT 'card',
  p_payment_status TEXT DEFAULT 'unpaid',
  p_shipping_status TEXT DEFAULT 'pending',
  p_shipping_address JSONB DEFAULT NULL,
  p_source TEXT DEFAULT 'online_store',
  p_notes TEXT DEFAULT NULL,
  p_ad_tracking JSONB DEFAULT NULL,
  p_selected_quote_id UUID DEFAULT NULL,
  p_shipping_provider TEXT DEFAULT NULL,
  p_tracking_number TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_tax_basis TEXT DEFAULT 'exclusive',
  p_gift_wrapping_fee NUMERIC DEFAULT 0,
  p_expected_total NUMERIC DEFAULT NULL,
  p_checkout_idempotency_key TEXT DEFAULT NULL,
  p_checkout_request_hash TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  order_number TEXT,
  tracking_token TEXT,
  subtotal NUMERIC,
  shipping_fee NUMERIC,
  discount_amount NUMERIC,
  tax_amount NUMERIC,
  total NUMERIC,
  customer_id UUID,
  customer_email TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  payment_status TEXT,
  shipping_status TEXT,
  payment_method TEXT,
  shipping_address JSONB,
  merchant_id UUID,
  tax_basis TEXT,
  gift_wrapping_fee NUMERIC,
  idempotency_replayed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- A transaction-local marker lets the update trigger distinguish the
  -- private idempotent replay update from other pending-order updates.  The
  -- original implementation is private and revoked below; all public wrappers
  -- continue to resolve through this guarded delegate.
  PERFORM pg_catalog.set_config(
    'baci.storefront_order_replay_context',
    'create_storefront_order',
    true
  );

  RETURN QUERY
  SELECT *
  FROM private.create_storefront_order_unchecked(
    p_merchant_id,
    p_customer_email,
    p_customer_name,
    p_items,
    p_customer_phone,
    p_shipping_fee,
    p_discount_amount,
    p_tax_amount,
    p_payment_method,
    p_payment_status,
    p_shipping_status,
    p_shipping_address,
    p_source,
    p_notes,
    p_ad_tracking,
    p_selected_quote_id,
    p_shipping_provider,
    p_tracking_number,
    p_user_id,
    p_tax_basis,
    p_gift_wrapping_fee,
    p_expected_total,
    p_checkout_idempotency_key,
    p_checkout_request_hash
  );
END;
$$;

REVOKE ALL ON FUNCTION private.create_storefront_order(
  uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text,
  text, jsonb, text, text, jsonb, uuid, text, text, uuid, text, numeric,
  numeric, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.create_storefront_order(
  uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text,
  text, jsonb, text, text, jsonb, uuid, text, text, uuid, text, numeric,
  numeric, text, text
) TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_storefront_order_replay_route_context
ON public.orders;

CREATE TRIGGER enforce_storefront_order_replay_route_context
BEFORE UPDATE ON public.orders
FOR EACH ROW
WHEN (
  COALESCE(
    current_setting('baci.storefront_order_replay_context', true),
    ''
  ) = 'create_storefront_order'
  AND OLD.checkout_idempotency_key IS NOT NULL
  AND NEW.checkout_idempotency_key IS NOT DISTINCT FROM OLD.checkout_idempotency_key
  AND NEW.shipping_status = 'pending'
)
EXECUTE FUNCTION private.enforce_storefront_order_route_context();

COMMENT ON TRIGGER enforce_storefront_order_replay_route_context ON public.orders IS
  'Requires the signed storefront route context (or an existing trusted internal context) only for idempotent create replay updates; independently authorized pending-order updates are not treated as replays.';

-- Qualify table columns that collide with RETURNS TABLE fields and PL/pgSQL locals.
CREATE OR REPLACE FUNCTION public.get_storefront_redvault_checkout_summary(p_order_id uuid)
RETURNS TABLE (
  order_id uuid, total numeric, currency text, tracking_token text,
  payment_method text, payment_status text, product_subtotal_kobo bigint,
  assurance_fee_kobo bigint, eligible_subtotal_kobo bigint,
  ineligible_subtotal_kobo bigint, discount_kobo bigint, tax_kobo bigint,
  shipping_kobo bigint, gift_wrapping_kobo bigint, payable_kobo bigint,
  mixed_basket boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  application private.uba_redvault_applications%ROWTYPE;
  persisted_order public.orders%ROWTYPE;
  product_subtotal bigint;
  assurance_fee bigint;
  eligible_subtotal bigint;
  persisted_discount bigint;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  SELECT * INTO application FROM private.uba_redvault_applications AS redvault_application
  WHERE redvault_application.order_id = p_order_id FOR SHARE;
  IF NOT FOUND OR application.status <> 'pending'
    OR application.merchant_id::text IS DISTINCT FROM auth.jwt()->>'storefront_order_merchant_id'
    OR application.customer_email IS DISTINCT FROM auth.jwt()->>'storefront_redvault_customer_email'
    OR application.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'redvault_customer_context_required';
  END IF;
  SELECT * INTO persisted_order FROM public.orders WHERE id = application.order_id FOR SHARE;
  IF NOT FOUND OR persisted_order.merchant_id IS DISTINCT FROM application.merchant_id
    OR lower(btrim(persisted_order.customer_email)) IS DISTINCT FROM application.customer_email
    OR persisted_order.payment_method <> 'uba_redvault'
    OR persisted_order.payment_status <> 'unpaid'
    OR persisted_order.currency IS NULL OR persisted_order.total IS NULL THEN
    RAISE EXCEPTION 'redvault_order_snapshot_mismatch';
  END IF;
  IF COALESCE(application.quote_payload->>'productSubtotalKobo', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'redvault_quote_invalid';
  END IF;
  product_subtotal := (application.quote_payload->>'productSubtotalKobo')::bigint;
  SELECT COALESCE(sum(greatest(coalesce(order_line.assurance_fee, 0), 0) * 100)::bigint, 0)
    INTO assurance_fee FROM public.order_items AS order_line WHERE order_line.order_id = p_order_id;
  eligible_subtotal := application.eligible_subtotal_kobo;
  persisted_discount := round(persisted_order.discount_amount * 100)::bigint;
  IF product_subtotal < eligible_subtotal
    OR persisted_discount <> application.discount_kobo
    OR round(persisted_order.subtotal * 100)::bigint <> product_subtotal + assurance_fee
    OR round(persisted_order.total * 100)::bigint < 0 THEN
    RAISE EXCEPTION 'redvault_order_snapshot_mismatch';
  END IF;
  RETURN QUERY SELECT persisted_order.id, persisted_order.total, persisted_order.currency,
    persisted_order.tracking_token, persisted_order.payment_method, persisted_order.payment_status,
    product_subtotal, assurance_fee, eligible_subtotal, product_subtotal - eligible_subtotal,
    application.discount_kobo, round(coalesce(persisted_order.tax_amount, 0) * 100)::bigint,
    round(coalesce(persisted_order.shipping_fee, 0) * 100)::bigint,
    round(coalesce(persisted_order.gift_wrapping_fee, 0) * 100)::bigint,
    round(persisted_order.total * 100)::bigint,
    product_subtotal > eligible_subtotal;
END;
$$;
ALTER FUNCTION public.get_storefront_redvault_checkout_summary(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_storefront_redvault_checkout_summary(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_redvault_checkout_summary(uuid) TO authenticated;

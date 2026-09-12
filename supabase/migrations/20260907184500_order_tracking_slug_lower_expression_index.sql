BEGIN;

-- Case-insensitive merchant slug lookup. The matching expression index is
-- created concurrently in a sibling non-transactional migration.
CREATE OR REPLACE FUNCTION public.get_order_tracking(
  p_merchant_slug TEXT,
  p_order_id UUID DEFAULT NULL,
  p_order_number TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_tracking_token TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  order_number TEXT,
  shipping_status TEXT,
  payment_status TEXT,
  subtotal NUMERIC,
  shipping_cost NUMERIC,
  discount_amount NUMERIC,
  tax_amount NUMERIC,
  total NUMERIC,
  currency TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  shipping_address JSONB,
  tracking_number TEXT,
  shipping_provider TEXT,
  paid_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  merchant_id UUID,
  merchant_business_name TEXT,
  merchant_slug TEXT,
  merchant_logo_url TEXT,
  merchant_support_email TEXT,
  merchant_support_phone TEXT,
  merchant_phone TEXT,
  items JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_merchant_id UUID;
  v_order_id UUID;
  v_is_token_lookup BOOLEAN := FALSE;
BEGIN
  IF p_merchant_slug IS NULL OR trim(p_merchant_slug) = '' THEN
    RAISE EXCEPTION 'merchant_slug_required';
  END IF;

  SELECT m.id INTO v_merchant_id
  FROM merchants m
  WHERE lower(m.slug) = lower(trim(p_merchant_slug))
  LIMIT 1;

  IF v_merchant_id IS NULL THEN
    RETURN;
  END IF;

  IF p_tracking_token IS NOT NULL AND trim(p_tracking_token) != '' THEN
    v_is_token_lookup := TRUE;
    SELECT o.id INTO v_order_id
    FROM orders o
    WHERE o.merchant_id = v_merchant_id
      AND o.tracking_token = p_tracking_token
    LIMIT 1;
  ELSE
    v_email := lower(trim(p_email));

    IF v_email IS NULL OR v_email = '' THEN
      RAISE EXCEPTION 'email_required';
    END IF;

    IF p_order_id IS NULL AND (p_order_number IS NULL OR trim(p_order_number) = '') THEN
      RAISE EXCEPTION 'order_id_or_number_required';
    END IF;

    SELECT o.id INTO v_order_id
    FROM orders o
    WHERE o.merchant_id = v_merchant_id
      AND lower(o.customer_email) = v_email
      AND (
        (
          p_order_id IS NOT NULL
          AND p_order_number IS NOT NULL
          AND o.id = p_order_id
          AND o.order_number = p_order_number
        )
        OR (
          p_order_id IS NOT NULL
          AND p_order_number IS NULL
          AND o.id = p_order_id
        )
        OR (
          p_order_id IS NULL
          AND p_order_number IS NOT NULL
          AND o.order_number = p_order_number
        )
      )
    LIMIT 1;
  END IF;

  IF v_order_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    o.shipping_status,
    o.payment_status,
    o.subtotal,
    o.shipping_fee AS shipping_cost,
    o.discount_amount,
    o.tax_amount,
    o.total,
    o.currency,
    o.created_at,
    o.updated_at,
    o.customer_name,
    CASE WHEN v_is_token_lookup THEN o.customer_email
    ELSE
      CASE WHEN o.customer_email IS NULL OR o.customer_email = '' THEN '***'
           WHEN position('@' in o.customer_email) = 0 THEN '***'
           WHEN length(split_part(o.customer_email, '@', 1)) <= 2
             THEN left(split_part(o.customer_email, '@', 1), 1) || '***@' || split_part(o.customer_email, '@', 2)
           ELSE left(split_part(o.customer_email, '@', 1), 2) || '***@' || split_part(o.customer_email, '@', 2)
      END
    END AS customer_email,
    CASE WHEN v_is_token_lookup THEN o.customer_phone
    ELSE
      CASE WHEN o.customer_phone IS NULL OR o.customer_phone = '' THEN '***'
           WHEN length(o.customer_phone) <= 6 THEN repeat('*', length(o.customer_phone))
           ELSE left(o.customer_phone, 2) || repeat('*', greatest(length(o.customer_phone) - 4, 2)) || right(o.customer_phone, 2)
      END
    END AS customer_phone,
    o.shipping_address,
    o.tracking_number,
    o.shipping_provider,
    o.paid_at,
    o.shipped_at,
    o.delivered_at,
    o.cancelled_at,
    m.id AS merchant_id,
    m.business_name AS merchant_business_name,
    m.slug AS merchant_slug,
    m.logo_url AS merchant_logo_url,
    m.support_email AS merchant_support_email,
    m.support_phone AS merchant_support_phone,
    m.phone AS merchant_phone,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', oi.id,
            'product_id', oi.product_id,
            'image_url', oi.image_url,
            'name', oi.name,
            'condition', oi.condition,
            'variant_name', oi.variant_name,
            'quantity', oi.quantity,
            'price', oi.price,
            'product_images', p.images
          )
          ORDER BY oi.line_id NULLS LAST, oi.id
        )
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id
      ),
      '[]'::jsonb
    ) AS items
  FROM orders o
  JOIN merchants m ON m.id = o.merchant_id
  WHERE o.id = v_order_id
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT) IS
  'Retrieve order tracking info by token (no email) or by email + order_id/number (legacy), including order item receipt snapshots such as image_url, condition, and variant_name.';

GRANT ALL ON FUNCTION public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT) TO anon;
GRANT ALL ON FUNCTION public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT ALL ON FUNCTION public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;

COMMIT;

BEGIN;

-- Success screens must emit invoice_generated only after the server
-- actually created the invoice artifacts. The immediate-order after()
-- builds those artifacts (persisted items, DVA, PDF, reminders) and sends
-- the proforma email, recording terminal success on the
-- immediate_order_notification_claims row (status 'sent'). Expose that
-- confirmation on the tracking projection so the web and mobile success
-- lookups can gate the funnel event on it instead of claiming it
-- optimistically at order creation.
DROP FUNCTION IF EXISTS public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT);

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
  payment_method TEXT,
  subtotal NUMERIC,
  shipping_cost NUMERIC,
  discount_amount NUMERIC,
  tax_amount NUMERIC,
  gift_wrapping_fee NUMERIC,
  total NUMERIC,
  amount_paid NUMERIC,
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
  external_source TEXT,
  import_job_id UUID,
  merchant_id UUID,
  merchant_business_name TEXT,
  merchant_slug TEXT,
  merchant_logo_url TEXT,
  merchant_support_email TEXT,
  merchant_support_phone TEXT,
  merchant_phone TEXT,
  items JSONB,
  payment_accounts JSONB,
  notification_delivered BOOLEAN
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
    o.payment_method,
    o.subtotal,
    o.shipping_fee AS shipping_cost,
    o.discount_amount,
    o.tax_amount,
    o.gift_wrapping_fee,
    o.total,
    o.amount_paid,
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
    o.external_source,
    o.import_job_id,
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
    ) AS items,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'account_number', opa.account_number,
            'bank_name', opa.bank_name,
            'account_name', opa.account_name,
            'provider', opa.provider,
            'assignment_customer_email_source', opa.assignment_customer_email_source,
            'created_at', opa.created_at,
            'assigned_at', opa.assigned_at,
            'expires_at', opa.expires_at
          )
          ORDER BY opa.created_at DESC NULLS LAST, opa.account_number
        )
        FROM order_payment_accounts opa
        WHERE opa.order_id = o.id
      ),
      '[]'::jsonb
    ) AS payment_accounts,
    -- Terminal after() delivery (invoice artifacts built and proforma
    -- emailed) confirms the generation the invoice_generated funnel event
    -- must wait for. Absent/pending/processing/failed rows read as not
    -- delivered so success screens keep their bounded refresh lane.
    EXISTS (
      SELECT 1
      FROM immediate_order_notification_claims c
      WHERE c.order_id = o.id
        AND c.status = 'sent'
    ) AS notification_delivered
  FROM orders o
  JOIN merchants m ON m.id = o.merchant_id
  WHERE o.id = v_order_id
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT) IS
  'Retrieve order tracking info by token (no email) or by email + order_id/number (legacy), including order item receipt snapshots such as image_url, condition, and variant_name, plus the stored payment method, imported-order source markers, and the terminal immediate-notification delivery flag that gates the invoice_generated funnel event.';

GRANT ALL ON FUNCTION public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT) TO anon;
GRANT ALL ON FUNCTION public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT ALL ON FUNCTION public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;

COMMIT;

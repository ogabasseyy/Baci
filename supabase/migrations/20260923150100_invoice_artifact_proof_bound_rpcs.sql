BEGIN;

-- Invoice artifact reads/writes run in the unauthenticated, user-facing
-- POST /api/orders flow (including the post-response after() fanout), so
-- they must not use the admin/service-role client (AGENTS.md). These
-- narrow SECURITY DEFINER functions carry their own proof: the order's
-- tracking token, minted at creation and emailed only to the requester.
-- Each function touches exactly one table with order-bound predicates.

CREATE OR REPLACE FUNCTION public.get_invoice_artifact_order_items(
  p_order_id UUID,
  p_tracking_token TEXT
)
RETURNS TABLE (
  id UUID,
  product_id UUID,
  variant_id UUID,
  variant_attributes JSONB,
  variant_name TEXT,
  condition TEXT,
  name TEXT,
  quantity INTEGER,
  price NUMERIC,
  has_assurance BOOLEAN,
  assurance_fee NUMERIC,
  item_description TEXT,
  line_extension_amount NUMERIC,
  vat_category_code TEXT,
  vat_rate NUMERIC,
  vat_amount NUMERIC,
  sellers_item_id TEXT,
  unit_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_order_id IS NULL OR p_tracking_token IS NULL
    OR trim(p_tracking_token) = '' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM orders o
    WHERE o.id = p_order_id
      AND o.tracking_token = p_tracking_token
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    oi.id,
    oi.product_id,
    oi.variant_id,
    oi.variant_attributes,
    oi.variant_name,
    oi.condition,
    oi.name,
    oi.quantity,
    oi.price,
    oi.has_assurance,
    oi.assurance_fee,
    oi.item_description,
    oi.line_extension_amount,
    oi.vat_category_code,
    oi.vat_rate,
    oi.vat_amount,
    oi.sellers_item_id,
    oi.unit_code
  FROM order_items oi
  WHERE oi.order_id = p_order_id
  ORDER BY oi.line_id NULLS LAST, oi.id;
END;
$$;

COMMENT ON FUNCTION public.get_invoice_artifact_order_items(UUID, TEXT) IS
  'Proof-bound persisted order-item read for invoice artifact rendering: the caller proves the order with its tracking token; returns the exact canonical snapshot columns.';

CREATE OR REPLACE FUNCTION public.insert_invoice_reminder(
  p_order_id UUID,
  p_tracking_token TEXT,
  p_channel TEXT,
  p_payment_link TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_order_id IS NULL OR p_tracking_token IS NULL
    OR trim(p_tracking_token) = '' THEN
    RETURN;
  END IF;

  IF p_channel NOT IN ('email', 'sms', 'whatsapp') THEN
    RAISE EXCEPTION 'invalid_reminder_channel';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM orders o
    WHERE o.id = p_order_id
      AND o.tracking_token = p_tracking_token
  ) THEN
    RETURN;
  END IF;

  INSERT INTO order_reminders (order_id, channel, payment_link)
  VALUES (p_order_id, p_channel, p_payment_link);
END;
$$;

COMMENT ON FUNCTION public.insert_invoice_reminder(UUID, TEXT, TEXT, TEXT) IS
  'Proof-bound initial invoice reminder log: the caller proves the order with its tracking token; inserts only the reminder row.';

GRANT ALL ON FUNCTION public.get_invoice_artifact_order_items(UUID, TEXT) TO anon;
GRANT ALL ON FUNCTION public.get_invoice_artifact_order_items(UUID, TEXT) TO authenticated;
GRANT ALL ON FUNCTION public.get_invoice_artifact_order_items(UUID, TEXT) TO service_role;

GRANT ALL ON FUNCTION public.insert_invoice_reminder(UUID, TEXT, TEXT, TEXT) TO anon;
GRANT ALL ON FUNCTION public.insert_invoice_reminder(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT ALL ON FUNCTION public.insert_invoice_reminder(UUID, TEXT, TEXT, TEXT) TO service_role;

COMMIT;

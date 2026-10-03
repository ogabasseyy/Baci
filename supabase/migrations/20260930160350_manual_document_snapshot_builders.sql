-- Purpose: deterministic order-line/tax/payment snapshot builders for the
-- atomic manual-document dispatch guard (20260930160400). Extracted into
-- their own file so 60400 stays under the 300-line split rule; field
-- selection must stay in lockstep with the sender-side builders in
-- apps/web/src/lib/manual-order-document-dispatch-items.ts.
-- Safe predeploy: pure reads (CREATE OR REPLACE FUNCTION, no data change).
CREATE OR REPLACE FUNCTION private.manual_document_item_snapshot(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', oi.id, 'name', oi.name, 'quantity', oi.quantity, 'price', oi.price,
    'variant_name', oi.variant_name, 'condition', oi.condition,
    'item_description', oi.item_description, 'assurance_fee', oi.assurance_fee,
    'line_id', oi.line_id,
    'unit_code', oi.unit_code,
    'line_extension_amount', oi.line_extension_amount,
    'vat_category_code', oi.vat_category_code, 'vat_rate', oi.vat_rate,
    'vat_amount', oi.vat_amount, 'sellers_item_id', oi.sellers_item_id
  ) ORDER BY oi.id), '[]'::jsonb)
  FROM public.order_items AS oi
  WHERE oi.order_id = p_order_id;
$$;
-- Both sides sort tax rows by id (uuid text order matches byte
-- order), so the canonical order is collation-independent.
CREATE OR REPLACE FUNCTION private.manual_document_tax_snapshot(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'vat_category_code', ts.vat_category_code, 'vat_rate', ts.vat_rate,
    'taxable_amount', ts.taxable_amount, 'tax_amount', ts.tax_amount,
    'exemption_reason', ts.exemption_reason
  ) ORDER BY ts.id), '[]'::jsonb)
  FROM public.order_tax_subtotals AS ts
  WHERE ts.order_id = p_order_id;
$$;
-- Settled-status filter mirrors the sender exactly: a row flipping
-- out changes the count and aborts; unsettled rows never count.
-- Metadata snapshots payment_method only, mirroring the trigger: the
-- PDF renders no other key.
CREATE OR REPLACE FUNCTION private.manual_document_transaction_snapshot(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'amount', t.amount, 'created_at', t.created_at,
    'description', t.description,
    'metadata', jsonb_build_object('payment_method', t.metadata->>'payment_method')
  ) ORDER BY t.id), '[]'::jsonb)
  FROM public.transactions AS t
  WHERE t.order_id = p_order_id AND t.transaction_type = 'payment'
    AND t.status IN ('completed', 'success');
$$;

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
REVOKE ALL ON FUNCTION private.manual_document_item_snapshot(uuid)
  FROM PUBLIC, anon, authenticated;
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
REVOKE ALL ON FUNCTION private.manual_document_tax_snapshot(uuid)
  FROM PUBLIC, anon, authenticated;
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
REVOKE ALL ON FUNCTION private.manual_document_transaction_snapshot(uuid)
  FROM PUBLIC, anon, authenticated;
-- Preferred virtual account mirrors the sender and the shared selector:
-- Paystack ranks first, then newest, over every eligible unexpired
-- non-legacy provider row; NULLs match null. Extracted so 60400 stays
-- under the split rule; NULLS LAST mirrors the sender (missing
-- created_at sorts last): a null-created row never beats a dated one.
CREATE OR REPLACE FUNCTION private.manual_document_payment_account_snapshot(p_order_id uuid)
RETURNS TABLE (
  account_number text, bank_name text, account_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT opa.account_number, opa.bank_name, opa.account_name
  FROM public.order_payment_accounts AS opa
  WHERE opa.order_id = p_order_id
    AND (opa.assignment_customer_email_source IS NULL
      OR opa.assignment_customer_email_source <> 'legacy_untrusted')
    AND (opa.expires_at IS NULL OR opa.expires_at > now() + interval '15 minutes')
    AND (COALESCE(opa.assigned_at, opa.created_at) IS NULL
      OR COALESCE(opa.assigned_at, opa.created_at) <= now())
  ORDER BY (opa.provider = 'paystack') DESC,
    opa.created_at DESC NULLS LAST, opa.account_number DESC, opa.id DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.manual_document_payment_account_snapshot(uuid)
  FROM PUBLIC, anon, authenticated;
-- True when this account state participates in the order's rendered
-- payment instructions: NGN currency (other currencies print no bank
-- details), eligible under the sender selector, and ranking first. The
-- account trigger evaluates OLD and NEW states through this so only
-- writes that move the rendered instructions reset in-flight markers.
CREATE OR REPLACE FUNCTION private.manual_document_renders_payment_account(
  p_order_id uuid, p_acct public.order_payment_accounts)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_currency text;
BEGIN
  SELECT o.currency INTO v_currency FROM public.orders AS o
  WHERE o.id = p_order_id;
  IF upper(trim(COALESCE(v_currency, 'NGN'))) IS DISTINCT FROM 'NGN' THEN
    RETURN false;
  END IF;
  IF NOT (p_acct.assignment_customer_email_source IS NULL
    OR p_acct.assignment_customer_email_source <> 'legacy_untrusted')
    OR NOT (p_acct.expires_at IS NULL
      OR p_acct.expires_at > now() + interval '15 minutes')
    OR NOT (COALESCE(p_acct.assigned_at, p_acct.created_at) IS NULL
      OR COALESCE(p_acct.assigned_at, p_acct.created_at) <= now()) THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.order_payment_accounts AS o
    WHERE o.order_id = p_order_id
      AND o.id IS DISTINCT FROM p_acct.id
      AND (o.assignment_customer_email_source IS NULL
        OR o.assignment_customer_email_source <> 'legacy_untrusted')
      AND (o.expires_at IS NULL OR o.expires_at > now() + interval '15 minutes')
      AND (COALESCE(o.assigned_at, o.created_at) IS NULL
        OR COALESCE(o.assigned_at, o.created_at) <= now())
      AND (
        -- Paystack outranks every other provider outright.
        ((o.provider = 'paystack') IS TRUE
          AND (p_acct.provider = 'paystack') IS NOT TRUE)
        OR (
          (((o.provider = 'paystack') IS TRUE)
            IS NOT DISTINCT FROM ((p_acct.provider = 'paystack') IS TRUE))
          AND (
            o.created_at > p_acct.created_at
            OR (o.created_at IS NOT NULL AND p_acct.created_at IS NULL)
            OR (
              (o.created_at = p_acct.created_at
                OR (o.created_at IS NULL AND p_acct.created_at IS NULL))
              AND o.account_number > p_acct.account_number
            )
            OR (
              (o.created_at = p_acct.created_at
                OR (o.created_at IS NULL AND p_acct.created_at IS NULL))
              AND o.account_number = p_acct.account_number
              AND o.id > p_acct.id
            )
          )
        )
      )
  );
END;
$$;
REVOKE ALL ON FUNCTION private.manual_document_renders_payment_account(uuid, public.order_payment_accounts)
  FROM PUBLIC, anon, authenticated;

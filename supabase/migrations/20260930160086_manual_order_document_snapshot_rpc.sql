-- Worker-owned dispatch snapshot for the manual-order document sender.
-- The sender runs with the outbox worker's service-role client; instead of
-- nine broad table reads it calls this one claim-bound RPC that returns the
-- exact projections the render/validate/snapshot path consumes. The claim
-- binding (processing + locked_by match) means a re-armed row whose claim
-- was stolen reads NULL and fails for a bounded retry instead of emailing
-- from a superseded snapshot.
-- Safe predeploy: brand-new RPC names (no base definitions), additive.
CREATE OR REPLACE FUNCTION public.get_manual_order_document_snapshot(
  p_outbox_id uuid,
  p_claim_owner text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_outbox record;
  v_result jsonb;
BEGIN
  SELECT o.id, o.order_id, o.merchant_id
  INTO v_outbox
  FROM public.order_notification_outbox AS o
  WHERE o.id = p_outbox_id
    AND o.status = 'processing'
    AND o.locked_by = p_claim_owner
    AND o.event_type IN ('manual_order_invoice', 'manual_order_receipt');
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'order', (SELECT row_to_json(ord) FROM (
      SELECT o.id, o.merchant_id, o.customer_id, o.recorded_by_user_id,
        o.import_job_id, o.external_source, o.order_number, o.created_at,
        o.transaction_date, o.invoice_issue_date, o.currency, o.total,
        o.subtotal, o.shipping_fee, o.tax_amount, o.discount_amount,
        o.amount_paid, o.payment_status, o.payment_method, o.shipping_status,
        o.customer_name, o.customer_email, o.customer_phone,
        o.shipping_address, o.invoice_type_code, o.invoice_note,
        o.payment_due_date, o.payment_terms, o.buyer_reference, o.firs_irn,
        o.firs_csid, o.notes,
        (SELECT coalesce(json_agg(item ORDER BY item.id), '[]'::json) FROM (
          SELECT oi.id, oi.line_id, oi.name, oi.quantity, oi.price,
            oi.variant_name, oi.condition, oi.item_description,
            oi.assurance_fee, oi.unit_code, oi.line_extension_amount,
            oi.vat_category_code, oi.vat_rate, oi.vat_amount,
            oi.sellers_item_id
          FROM public.order_items AS oi
          WHERE oi.order_id = o.id
        ) AS item) AS order_items
      FROM public.orders AS o
      WHERE o.id = v_outbox.order_id AND o.merchant_id = v_outbox.merchant_id
    ) AS ord),
    'merchant', (SELECT row_to_json(m) FROM (
      SELECT m.id, m.slug, m.business_name, m.email_sender_name, m.logo_url,
        m.email, m.phone, m.support_email, m.support_phone,
        m.business_address, m.registered_address, m.cac_rc_number,
        m.tax_identification_number, m.legal_entity_name,
        m.vat_registration_status, m.vat_rate, m.bank_code,
        m.bank_account_number, m.bank_name, m.bank_account_name,
        m.brand_colors
      FROM public.merchants AS m
      WHERE m.id = v_outbox.merchant_id
    ) AS m),
    'tax_subtotals', (SELECT coalesce(json_agg(t ORDER BY t.id), '[]'::json) FROM (
      SELECT s.id, s.vat_category_code, s.vat_rate, s.taxable_amount,
        s.tax_amount, s.exemption_reason
      FROM public.order_tax_subtotals AS s
      WHERE s.order_id = v_outbox.order_id
    ) AS t),
    -- Settled payment history only (Paystack 'success' settles like
    -- manual 'completed'): the PDF table, the receipt date, and the mark
    -- snapshot all consume exactly this set, so the database filters once
    -- instead of every reader re-implementing it.
    'transactions', (SELECT coalesce(json_agg(t ORDER BY t.created_at, t.id), '[]'::json) FROM (
      SELECT tr.id, tr.amount, tr.created_at, tr.description, tr.metadata,
        tr.gateway, tr.status, tr.transaction_type
      FROM public.transactions AS tr
      WHERE tr.order_id = v_outbox.order_id
        AND tr.transaction_type = 'payment'
        AND tr.status IN ('completed', 'success')
    ) AS t),
    'payment_accounts', (SELECT coalesce(json_agg(a ORDER BY a.created_at DESC NULLS LAST, a.account_number DESC, a.id DESC), '[]'::json) FROM (
      SELECT opa.id, opa.account_number, opa.bank_name, opa.account_name,
        opa.provider, opa.assignment_customer_email_source,
        opa.created_at, opa.assigned_at, opa.expires_at
      FROM public.order_payment_accounts AS opa
      WHERE opa.order_id = v_outbox.order_id
    ) AS a),
    'claim_domain', (SELECT d.domain FROM public.domains AS d
      WHERE d.merchant_id = v_outbox.merchant_id
        AND d.is_primary IS TRUE AND d.status = 'active'
      ORDER BY d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST, d.id
      LIMIT 1)
  ) INTO v_result;

  -- The order/merchant tenant match above doubles as the missing-row check:
  -- without both rows the sender skips order_or_merchant_missing.
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_manual_order_document_snapshot(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_manual_order_document_snapshot(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.get_manual_order_document_snapshot(uuid, text)
  IS 'Returns the claim-bound dispatch snapshot for the manual-order document sender.';

-- Claim-sent marker as an RPC so the sender performs no direct table write.
-- The sender passes the hash it actually mailed: this runs solely after
-- provider acceptance, so the mailed hash is known-delivered and advances
-- delivered_token_hash past whatever rotations later retries perform. A
-- NULL mailed hash keeps the incumbent (never wipes a delivered bearer).
CREATE OR REPLACE FUNCTION public.mark_manual_document_claim_sent(
  p_claim_id uuid,
  p_merchant_id uuid,
  p_mailed_token_hash text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  UPDATE public.receipt_claims AS c
  SET notification_sent_at = now(),
    delivered_token_hash = COALESCE(p_mailed_token_hash, c.delivered_token_hash)
  WHERE c.id = p_claim_id AND c.merchant_id = p_merchant_id
  RETURNING c.id;
$function$;

REVOKE ALL ON FUNCTION public.mark_manual_document_claim_sent(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_manual_document_claim_sent(uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.mark_manual_document_claim_sent(uuid, uuid, text)
  IS 'Marks a manual-order receipt claim notified after provider acceptance.';

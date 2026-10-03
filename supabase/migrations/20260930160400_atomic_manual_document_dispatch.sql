-- Atomically validate the rendered snapshot and mark dispatch start for a
-- manual-order document. A check-then-mark in application code leaves a
-- millisecond race between the re-read and the marker; this function locks
-- items/transactions, parent, merchant, tax, then takes the per-order and
-- per-merchant advisory gates. Items and transactions go first because
-- their row triggers enter holding those locks, while tax goes after the
-- parent to match the historical tax-rebuild trigger's parent-to-child
-- order. A payment, contact correction, or item edit landing mid-dispatch
-- aborts instead of sending a stale document. The snapshot covers every
-- order-row input the renderer reads (identity, money, notes, address,
-- dates, item contents) plus the manual-order origin fields, and the sent
-- kind lands in row metadata so claim previews survive later payments.
-- Payment instructions compare for invoice and proforma kinds only
-- (receipts render none); the issuer identity compares for every kind
-- since receipts print the issuer header too. VAT subtotals, payment
-- history (settled filter), and the claim-link domain compare as count
-- plus canonical rows. The worker retries after an abort and converges.
-- Safe predeploy: only the new worker calls it.
-- Advisory gates exist regardless of outbox status; rows precede them
-- on every path and multi-key holders sort ascending, so no cycle forms.
-- The marker write re-validates the lease. DROP before CREATE: the
-- branding params changed the signature, which OR REPLACE cannot do.
DROP FUNCTION IF EXISTS public.mark_manual_document_dispatch_started(uuid, text, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, timestamptz, date, jsonb, uuid, uuid, text, text, integer, jsonb, text, text, text, text, text, text, text, integer, jsonb, integer, jsonb, text, text, text, jsonb, text, text, text, numeric, text, text, text, text, text, timestamptz, text, text, jsonb, date, text, text, text, text);
CREATE OR REPLACE FUNCTION public.mark_manual_document_dispatch_started(
  p_outbox_id uuid,
  p_claim_owner text,
  p_customer_id uuid,
  p_customer_email text,
  p_customer_name text,
  p_customer_phone text,
  p_total numeric,
  p_subtotal numeric,
  p_shipping_fee numeric,
  p_tax_amount numeric,
  p_discount_amount numeric,
  p_amount_paid numeric,
  p_currency text,
  p_order_number text,
  p_payment_status text,
  p_payment_method text,
  p_shipping_status text,
  p_invoice_type_code text,
  p_invoice_note text,
  p_notes text,
  p_transaction_date timestamptz,
  p_invoice_issue_date date,
  p_shipping_address jsonb,
  p_recorded_by_user_id uuid,
  p_import_job_id uuid,
  p_external_source text,
  p_document_kind text,
  p_item_count integer,
  p_items jsonb,
  p_merchant_bank_code text,
  p_merchant_bank_account_number text,
  p_merchant_bank_name text,
  p_merchant_bank_account_name text,
  p_va_account_number text,
  p_va_bank_name text,
  p_va_account_name text,
  p_tax_count integer,
  p_tax_subtotals jsonb,
  p_txn_count integer,
  p_transactions jsonb,
  p_merchant_business_name text,
  p_merchant_legal_entity_name text,
  p_merchant_business_address text,
  p_merchant_registered_address jsonb,
  p_merchant_cac_rc_number text,
  p_merchant_tax_identification_number text,
  p_merchant_vat_registration_status text,
  p_merchant_vat_rate numeric,
  p_claim_domain text,
  p_merchant_support_email text,
  p_merchant_support_phone text,
  p_merchant_phone text,
  p_merchant_slug text,
  p_order_created_at timestamptz,
  -- Rendered branding + From name compare; trailing defaults keep old
  -- positional harness calls valid while the sender passes explicit values.
  p_merchant_email_sender_name text DEFAULT NULL,
  p_merchant_logo_url text DEFAULT NULL,
  p_merchant_brand_colors jsonb DEFAULT NULL,
  -- Rendered invoice terms + fiscal references compare; same trailing-
  -- default discipline as branding: old positional calls stay valid.
  p_payment_due_date date DEFAULT NULL,
  p_payment_terms text DEFAULT NULL,
  p_buyer_reference text DEFAULT NULL,
  p_firs_irn text DEFAULT NULL,
  p_firs_csid text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_notification public.order_notification_outbox%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_order_id uuid;
  v_merchant_id uuid;
  v_item_count bigint;
  v_items jsonb;
  v_merchant_bank_code text;
  v_merchant_bank_account_number text;
  v_merchant_bank_name text;
  v_merchant_bank_account_name text;
  v_va_account_number text;
  v_va_bank_name text;
  v_va_account_name text;
  v_compare_invoice_only boolean;
  v_tax_count bigint;
  v_tax_subtotals jsonb;
  v_txn_count bigint;
  v_transactions jsonb;
  v_merchant_business_name text;
  v_merchant_legal_entity_name text;
  v_merchant_business_address text;
  v_merchant_registered_address jsonb;
  v_merchant_cac_rc_number text;
  v_merchant_tax_identification_number text;
  v_merchant_vat_registration_status text;
  v_merchant_vat_rate numeric;
  v_claim_domain text;
  v_merchant_support_email text;
  v_merchant_support_phone text;
  v_merchant_phone text;
  v_merchant_slug text;
  v_merchant_email_sender_name text; v_merchant_logo_url text; v_merchant_brand_colors jsonb;
BEGIN
  IF p_document_kind NOT IN ('receipt', 'invoice', 'proforma_invoice') THEN
    RAISE EXCEPTION 'unknown manual document kind: %', p_document_kind;
  END IF;
  -- Receipts render no payment instructions and no subtotal breakdown:
  -- bank, virtual-account, and tax compares run for invoices only.
  v_compare_invoice_only := p_document_kind <> 'receipt';
  -- Lock order (child rows, parent, advisory): tax follows the parent to
  -- match the historical rebuild trigger. The outbox seed is re-validated below.
  SELECT n.order_id, n.merchant_id INTO v_order_id, v_merchant_id
  FROM public.order_notification_outbox AS n WHERE n.id = p_outbox_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'lease_lost');
  END IF;
  PERFORM 1 FROM public.order_items AS oi
  WHERE oi.order_id = v_order_id FOR SHARE OF oi;
  PERFORM 1 FROM public.transactions AS t
  WHERE t.order_id = v_order_id AND t.transaction_type = 'payment'
    AND t.status IN ('completed', 'success') FOR SHARE OF t;
  SELECT o.* INTO v_order FROM public.orders AS o
  WHERE o.id = v_order_id AND o.merchant_id = v_merchant_id
  FOR SHARE;
  -- Preferred virtual account mirrors the sender and the shared
  -- selector: Paystack ranks first, then newest, over every eligible
  -- unexpired non-legacy provider row; NULLs match null.
  SELECT m.business_name, m.legal_entity_name, m.business_address,
    m.registered_address, m.cac_rc_number, m.tax_identification_number,
    m.vat_registration_status, m.vat_rate, m.support_email, m.support_phone,
    m.phone, m.bank_code, m.bank_account_number, m.bank_name,
    m.bank_account_name, m.slug, m.email_sender_name, m.logo_url, m.brand_colors
  INTO v_merchant_business_name, v_merchant_legal_entity_name,
    v_merchant_business_address, v_merchant_registered_address,
    v_merchant_cac_rc_number, v_merchant_tax_identification_number,
    v_merchant_vat_registration_status, v_merchant_vat_rate,
    v_merchant_support_email, v_merchant_support_phone, v_merchant_phone,
    v_merchant_bank_code, v_merchant_bank_account_number,
    v_merchant_bank_name, v_merchant_bank_account_name, v_merchant_slug,
    v_merchant_email_sender_name, v_merchant_logo_url, v_merchant_brand_colors
  FROM public.merchants AS m WHERE m.id = v_order.merchant_id FOR SHARE;
  -- Tax locks AFTER the parent: the historical tax-rebuild trigger runs
  -- parent-to-child, so tax-first here deadlocks against a concurrent
  -- item insert. Items/transactions stay child-first to match the row
  -- triggers that enter holding those locks.
  PERFORM 1 FROM public.order_tax_subtotals AS ts
  WHERE ts.order_id = v_order_id FOR SHARE OF ts;
  -- Advisory gates after all row locks: the writers this serializes
  -- against take the same keys after their row locks.
  PERFORM private.lock_manual_document_gate_keys(
    private.manual_document_gate_key('order', v_order_id),
    private.manual_document_gate_key('merchant', v_merchant_id));
  SELECT n.* INTO v_notification FROM public.order_notification_outbox AS n
  WHERE n.id = p_outbox_id AND n.status = 'processing'
    AND n.locked_by = p_claim_owner AND n.dispatch_started_at IS NULL
    AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt');
  IF NOT FOUND OR v_order IS NULL THEN
    RETURN jsonb_build_object('status', 'lease_lost');
  END IF;
  -- Post-gate re-reads, lock-free: the gate serialized against every
  -- invalidation trigger, so these see all committed writes. Locking here
  -- would reverse the rows-before-advisory order and deadlock.
  SELECT d.domain INTO v_claim_domain
  FROM public.domains AS d
  WHERE d.merchant_id = v_merchant_id AND d.is_primary = true
    AND d.status = 'active'
  ORDER BY d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST, d.id
  LIMIT 1;
  IF v_compare_invoice_only THEN
    SELECT opa.account_number, opa.bank_name, opa.account_name
    INTO v_va_account_number, v_va_bank_name, v_va_account_name
    FROM public.order_payment_accounts AS opa
    WHERE opa.order_id = v_order.id
      AND (opa.assignment_customer_email_source IS NULL
        OR opa.assignment_customer_email_source <> 'legacy_untrusted')
      AND (opa.expires_at IS NULL OR opa.expires_at > now() + interval '15 minutes')
      -- The sender's selector rejects future assignments; skip them too.
      AND (COALESCE(opa.assigned_at, opa.created_at) IS NULL OR COALESCE(opa.assigned_at, opa.created_at) <= now())
    -- Paystack-first, then newest, like the shared selector: only
    -- Paystack DVA rows match the webhook. NULLS LAST mirrors the sender
    -- (missing created_at sorts last): a null-created row never beats a
    -- dated one.
    ORDER BY (opa.provider = 'paystack') DESC, opa.created_at DESC NULLS LAST, opa.account_number DESC LIMIT 1;
  END IF;
  SELECT count(*) INTO v_item_count FROM public.order_items AS oi
  WHERE oi.order_id = v_order.id;
  -- Snapshot field selection must stay in lockstep with the sender in
  -- apps/web/src/lib/manual-order-document-dispatch-items.ts.
  SELECT private.manual_document_item_snapshot(v_order.id) INTO v_items;
  SELECT count(*) INTO v_tax_count FROM public.order_tax_subtotals AS ts
  WHERE ts.order_id = v_order.id;
  SELECT private.manual_document_tax_snapshot(v_order.id) INTO v_tax_subtotals;
  SELECT count(*) INTO v_txn_count FROM public.transactions AS t
  WHERE t.order_id = v_order.id AND t.transaction_type = 'payment'
    AND t.status IN ('completed', 'success');
  SELECT private.manual_document_transaction_snapshot(v_order.id)
  INTO v_transactions;
  IF v_order.customer_id IS DISTINCT FROM p_customer_id
    OR lower(trim(both from COALESCE(v_order.customer_email, ''))) IS DISTINCT FROM lower(trim(both from COALESCE(p_customer_email, '')))
    OR v_order.customer_name IS DISTINCT FROM p_customer_name
    OR v_order.customer_phone IS DISTINCT FROM p_customer_phone
    OR v_order.recorded_by_user_id IS DISTINCT FROM p_recorded_by_user_id
    OR v_order.import_job_id IS DISTINCT FROM p_import_job_id
    OR v_order.external_source IS DISTINCT FROM p_external_source
    OR v_order.total IS DISTINCT FROM p_total
    OR v_order.subtotal IS DISTINCT FROM p_subtotal
    OR v_order.shipping_fee IS DISTINCT FROM p_shipping_fee
    OR v_order.tax_amount IS DISTINCT FROM p_tax_amount
    OR v_order.discount_amount IS DISTINCT FROM p_discount_amount
    OR v_order.amount_paid IS DISTINCT FROM p_amount_paid
    OR v_order.currency IS DISTINCT FROM p_currency
    OR v_order.order_number IS DISTINCT FROM p_order_number
    OR v_order.payment_status IS DISTINCT FROM p_payment_status
    OR v_order.payment_method IS DISTINCT FROM p_payment_method
    OR v_order.shipping_status IS DISTINCT FROM p_shipping_status
    OR v_order.invoice_type_code IS DISTINCT FROM p_invoice_type_code
    OR v_order.invoice_note IS DISTINCT FROM p_invoice_note
    OR v_order.notes IS DISTINCT FROM p_notes
    OR v_order.transaction_date IS DISTINCT FROM p_transaction_date
    OR v_order.invoice_issue_date IS DISTINCT FROM p_invoice_issue_date
    OR v_order.payment_due_date IS DISTINCT FROM p_payment_due_date
    OR v_order.payment_terms IS DISTINCT FROM p_payment_terms
    OR v_order.buyer_reference IS DISTINCT FROM p_buyer_reference
    OR v_order.firs_irn IS DISTINCT FROM p_firs_irn
    OR v_order.firs_csid IS DISTINCT FROM p_firs_csid
    OR v_order.created_at IS DISTINCT FROM p_order_created_at
    OR v_order.shipping_address IS DISTINCT FROM p_shipping_address
    OR v_item_count IS DISTINCT FROM p_item_count::bigint
    OR v_items IS DISTINCT FROM p_items
    OR v_merchant_business_name IS DISTINCT FROM p_merchant_business_name
    OR v_merchant_legal_entity_name IS DISTINCT FROM p_merchant_legal_entity_name
    OR v_merchant_business_address IS DISTINCT FROM p_merchant_business_address
    OR v_merchant_registered_address IS DISTINCT FROM p_merchant_registered_address
    OR v_merchant_cac_rc_number IS DISTINCT FROM p_merchant_cac_rc_number
    OR v_merchant_tax_identification_number IS DISTINCT FROM p_merchant_tax_identification_number
    OR v_merchant_vat_registration_status IS DISTINCT FROM p_merchant_vat_registration_status
    OR v_merchant_vat_rate IS DISTINCT FROM p_merchant_vat_rate
    OR v_merchant_support_email IS DISTINCT FROM p_merchant_support_email
    OR v_merchant_support_phone IS DISTINCT FROM p_merchant_support_phone
    OR v_merchant_phone IS DISTINCT FROM p_merchant_phone
    -- Without an active custom domain the claim URL falls back to the
    -- slug subdomain, so a slug change must abort like a domain change.
    OR v_merchant_slug IS DISTINCT FROM p_merchant_slug
    OR v_merchant_email_sender_name IS DISTINCT FROM p_merchant_email_sender_name
    OR v_merchant_logo_url IS DISTINCT FROM p_merchant_logo_url
    OR v_merchant_brand_colors IS DISTINCT FROM p_merchant_brand_colors
    OR v_claim_domain IS DISTINCT FROM p_claim_domain
    OR (v_compare_invoice_only AND (
      v_merchant_bank_code IS DISTINCT FROM p_merchant_bank_code
      OR v_merchant_bank_account_number IS DISTINCT FROM p_merchant_bank_account_number
      OR v_merchant_bank_name IS DISTINCT FROM p_merchant_bank_name
      OR v_merchant_bank_account_name IS DISTINCT FROM p_merchant_bank_account_name
      OR v_va_account_number IS DISTINCT FROM p_va_account_number
      OR v_va_bank_name IS DISTINCT FROM p_va_bank_name
      OR v_va_account_name IS DISTINCT FROM p_va_account_name
      OR v_tax_count IS DISTINCT FROM p_tax_count::bigint
      OR v_tax_subtotals IS DISTINCT FROM p_tax_subtotals))
    OR v_txn_count IS DISTINCT FROM p_txn_count::bigint
    OR v_transactions IS DISTINCT FROM p_transactions
  THEN
    RETURN jsonb_build_object('status', 'stale');
  END IF;
  UPDATE public.order_notification_outbox AS n
  SET dispatch_started_at = now(), updated_at = now(),
    metadata = COALESCE(n.metadata, '{}'::jsonb) || jsonb_build_object('sent_document_kind', p_document_kind)
  WHERE n.id = p_outbox_id AND n.status = 'processing' AND n.locked_by = p_claim_owner;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'lease_lost'); END IF;
  RETURN jsonb_build_object('status', 'marked');
END;
$$;
-- Grants live in this creation migration: the applier commits each file
-- separately, so a split grant would expose PUBLIC execute between commits.
REVOKE ALL ON FUNCTION public.mark_manual_document_dispatch_started(uuid, text, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, timestamptz, date, jsonb, uuid, uuid, text, text, integer, jsonb, text, text, text, text, text, text, text, integer, jsonb, integer, jsonb, text, text, text, jsonb, text, text, text, numeric, text, text, text, text, text, timestamptz, text, text, jsonb, date, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_manual_document_dispatch_started(uuid, text, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, timestamptz, date, jsonb, uuid, uuid, text, text, integer, jsonb, text, text, text, text, text, text, text, integer, jsonb, integer, jsonb, text, text, text, jsonb, text, text, text, numeric, text, text, text, text, text, timestamptz, text, text, jsonb, date, text, text, text, text)
  TO service_role;

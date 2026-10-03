-- Atomically validate the rendered snapshot and mark dispatch start for a
-- manual-order document. A check-then-mark in application code leaves a
-- millisecond race between the re-read and the marker; this function locks
-- items/transactions, parent, merchant, account, tax, then outbox. Items
-- and transactions go first because their row triggers enter holding those
-- locks, while tax goes after the parent to match the historical
-- tax-rebuild trigger's parent-to-child order; any other sequence
-- deadlocks against concurrent staff edits. A payment, contact
-- correction, or item edit landing mid-dispatch aborts instead of sending
-- a stale document. The snapshot
-- covers every order-row input the renderer reads (identity, money
-- breakdown, notes, address, dates, and item contents including
-- descriptions) plus the manual-order origin fields: a same-total money
-- redistribution, address correction, or eligibility change
-- (recorded_by cleared, import/external set) aborts too.
-- The rendered document kind is snapshotted into the row metadata so claim
-- previews keep showing the sent kind after later payments. The rendered
-- payment instructions are snapshotted too (merchant bank fields plus the
-- preferred virtual account): a bank-detail edit landing mid-dispatch would
-- otherwise email obsolete instructions and misdirect the customer's
-- transfer. Receipts render no payment instructions, so the payment
-- comparison (including the virtual-account lookup) only runs for invoice
-- and proforma kinds; otherwise every receipt for an order with an assigned
-- account would spuriously abort. The rendered issuer identity (business
-- name, legal entity, addresses, RC/TIN, VAT registration) is compared for
-- every kind instead: receipts print the issuer header too, so a committed
-- correction must abort rather than email stale issuer or tax data.
-- Cosmetic merchant fields (logo, colors) stay outside the snapshot, as do
-- ledger rows, which derive from the covered payment state. The rendered
-- VAT subtotals are snapshotted (count plus canonical rows) since a
-- same-total category correction would otherwise email a stale tax
-- breakdown. The worker retries after an abort and converges (fresh send
-- or document_state_changed skip). Safe predeploy: only the new worker
-- calls it. The rendered payment-history rows are snapshotted the same way
-- (count plus canonical rows over the sender's settled-status filter): a
-- payment inserted or corrected mid-dispatch would otherwise email a stale
-- Payment table.
-- Every child-table read below locks its rows FOR SHARE first (locking
-- clauses are illegal on aggregates, so a bare PERFORM takes the locks and
-- the count/canonical-row aggregates re-read the locked rows), so a
-- concurrent item, tax, transaction, or account UPDATE/DELETE blocks until
-- this comparison commits instead of slipping between the re-read and the
-- mark; the writer's trigger then sees the set marker and resets it, and
-- the worker's post-transport lease check aborts the stale send for a
-- bounded retry. Pure INSERTs during this function's own microseconds
-- cannot take a row lock, so a same-instant insert can still miss both the
-- comparison and the reset; that residual is bounded by this transaction's
-- duration (no I/O inside) rather than the whole send window.
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
  p_claim_domain text
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
  v_compare_payment boolean;
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
BEGIN
  IF p_document_kind NOT IN ('receipt', 'invoice', 'proforma_invoice') THEN
    RAISE EXCEPTION 'unknown manual document kind: %', p_document_kind;
  END IF;
  -- Receipts render no payment instructions, so the payment snapshot only
  -- applies to invoice and proforma kinds.
  v_compare_payment := p_document_kind <> 'receipt';
  -- Lock order (child, parent, merchant, account, outbox): item triggers
  -- enter holding a child lock, so parent-first deadlocks. The unlocked
  -- outbox seed is re-validated under the outbox lock below.
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
  -- Preferred virtual account mirrors the sender (latest unexpired
  -- non-legacy paystack row); a missing row leaves NULLs, matching null.
  SELECT m.business_name, m.legal_entity_name, m.business_address,
    m.registered_address, m.cac_rc_number, m.tax_identification_number,
    m.vat_registration_status, m.vat_rate,
    m.bank_code, m.bank_account_number, m.bank_name, m.bank_account_name
  INTO v_merchant_business_name, v_merchant_legal_entity_name,
    v_merchant_business_address, v_merchant_registered_address,
    v_merchant_cac_rc_number, v_merchant_tax_identification_number,
    v_merchant_vat_registration_status, v_merchant_vat_rate,
    v_merchant_bank_code, v_merchant_bank_account_number,
    v_merchant_bank_name, v_merchant_bank_account_name
  FROM public.merchants AS m WHERE m.id = v_order.merchant_id FOR SHARE;
  -- The claim URL embeds the active primary domain; a deactivation between
  -- the sender's resolve and this mark must abort rather than email a CTA
  -- that no longer routes. Mirrors resolveManualDocumentClaimDomain.
  SELECT d.domain INTO v_claim_domain
  FROM public.domains AS d
  WHERE d.merchant_id = v_merchant_id AND d.is_primary = true
    AND d.status = 'active'
  ORDER BY d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST, d.id
  LIMIT 1 FOR SHARE;
  IF v_compare_payment THEN
    SELECT opa.account_number, opa.bank_name, opa.account_name
    INTO v_va_account_number, v_va_bank_name, v_va_account_name
    FROM public.order_payment_accounts AS opa
    WHERE opa.order_id = v_order.id AND opa.provider = 'paystack'
      AND (opa.assignment_customer_email_source IS NULL
        OR opa.assignment_customer_email_source <> 'legacy_untrusted')
      -- A 15-minute validity buffer: an account expiring mid-delivery
      -- would embed unusable instructions with no mutation for a trigger
      -- to catch. Mirrors the sender's cutoff (see resolveInvoicePaymentAccount).
      AND (opa.expires_at IS NULL OR opa.expires_at > now() + interval '15 minutes')
    -- now() is transaction-stable: break created_at ties by account
    -- number, exactly like the renderer, so rechecks never flap.
    ORDER BY opa.created_at DESC, opa.account_number DESC LIMIT 1 FOR SHARE;
  END IF;
  -- Tax locks AFTER the parent: the historical tax-rebuild trigger runs
  -- parent-to-child, so tax-first here deadlocks against a concurrent
  -- item insert. Items/transactions stay child-first to match the row
  -- triggers that enter holding those locks.
  PERFORM 1 FROM public.order_tax_subtotals AS ts
  WHERE ts.order_id = v_order_id FOR SHARE OF ts;
  SELECT n.* INTO v_notification FROM public.order_notification_outbox AS n
  WHERE n.id = p_outbox_id AND n.status = 'processing'
    AND n.locked_by = p_claim_owner AND n.dispatch_started_at IS NULL
    AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
  FOR UPDATE;
  IF NOT FOUND OR v_order IS NULL THEN
    RETURN jsonb_build_object('status', 'lease_lost');
  END IF;
  SELECT count(*) INTO v_item_count FROM public.order_items AS oi
  WHERE oi.order_id = v_order.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', oi.id, 'name', oi.name, 'quantity', oi.quantity, 'price', oi.price,
    'variant_name', oi.variant_name, 'condition', oi.condition,
    'item_description', oi.item_description
  ) ORDER BY oi.id), '[]'::jsonb) INTO v_items
  FROM public.order_items AS oi
  WHERE oi.order_id = v_order.id;
  -- Both sides sort tax rows by id (uuid text order matches byte
  -- order), so the canonical order is collation-independent.
  SELECT count(*) INTO v_tax_count FROM public.order_tax_subtotals AS ts
  WHERE ts.order_id = v_order.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'vat_category_code', ts.vat_category_code, 'vat_rate', ts.vat_rate,
    'taxable_amount', ts.taxable_amount, 'tax_amount', ts.tax_amount,
    'exemption_reason', ts.exemption_reason
  ) ORDER BY ts.id), '[]'::jsonb) INTO v_tax_subtotals
  FROM public.order_tax_subtotals AS ts
  WHERE ts.order_id = v_order.id;
  -- Settled-status filter mirrors the sender exactly: a row flipping
  -- out changes the count and aborts; unsettled rows never count.
  SELECT count(*) INTO v_txn_count FROM public.transactions AS t
  WHERE t.order_id = v_order.id AND t.transaction_type = 'payment'
    AND t.status IN ('completed', 'success');
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'amount', t.amount, 'created_at', t.created_at,
    'description', t.description, 'metadata', t.metadata
  ) ORDER BY t.id), '[]'::jsonb) INTO v_transactions
  FROM public.transactions AS t
  WHERE t.order_id = v_order.id AND t.transaction_type = 'payment'
    AND t.status IN ('completed', 'success');
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
    OR v_claim_domain IS DISTINCT FROM p_claim_domain
    OR (v_compare_payment AND (
      v_merchant_bank_code IS DISTINCT FROM p_merchant_bank_code
      OR v_merchant_bank_account_number IS DISTINCT FROM p_merchant_bank_account_number
      OR v_merchant_bank_name IS DISTINCT FROM p_merchant_bank_name
      OR v_merchant_bank_account_name IS DISTINCT FROM p_merchant_bank_account_name
      OR v_va_account_number IS DISTINCT FROM p_va_account_number
      OR v_va_bank_name IS DISTINCT FROM p_va_bank_name
      OR v_va_account_name IS DISTINCT FROM p_va_account_name))
    OR v_tax_count IS DISTINCT FROM p_tax_count::bigint
    OR v_tax_subtotals IS DISTINCT FROM p_tax_subtotals
    OR v_txn_count IS DISTINCT FROM p_txn_count::bigint
    OR v_transactions IS DISTINCT FROM p_transactions
  THEN
    RETURN jsonb_build_object('status', 'stale');
  END IF;
  UPDATE public.order_notification_outbox AS n
  SET dispatch_started_at = now(), updated_at = now(),
    metadata = COALESCE(n.metadata, '{}'::jsonb)
      || jsonb_build_object('sent_document_kind', p_document_kind)
  WHERE n.id = p_outbox_id;
  RETURN jsonb_build_object('status', 'marked');
END;
$$;
REVOKE ALL ON FUNCTION public.mark_manual_document_dispatch_started(uuid, text, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, timestamptz, date, jsonb, uuid, uuid, text, text, integer, jsonb, text, text, text, text, text, text, text, integer, jsonb, integer, jsonb, text, text, text, jsonb, text, text, text, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_manual_document_dispatch_started(uuid, text, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, timestamptz, date, jsonb, uuid, uuid, text, text, integer, jsonb, text, text, text, text, text, text, text, integer, jsonb, integer, jsonb, text, text, text, jsonb, text, text, text, numeric, text)
  TO service_role;

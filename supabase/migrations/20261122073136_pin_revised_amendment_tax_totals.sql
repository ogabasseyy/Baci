-- Freeze the revised tax subtotal and seller VAT context with the document.
CREATE OR REPLACE FUNCTION private.paid_order_invoice_snapshot(p_order_id uuid,p_include_fulfillment boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('order',(
    SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(o))
    WHERE key IN ('id','order_number','currency','total','subtotal','amount_paid','payment_status',
      'created_at','updated_at','shipping_status','paid_at','shipped_at','delivered_at','cancelled_at',
      'transaction_date','invoice_issue_date','tax_point_date','invoice_type_code','customer_name',
      'customer_email','customer_phone','shipping_address','tax_amount','shipping_fee','discount_amount',
      'tax_exclusive_amount','tax_inclusive_amount','invoice_note','buyer_reference',
      'purchase_order_reference','payment_terms','payment_due_date','notes')
      OR (p_include_fulfillment AND key = 'fulfillment_details')
  ),'items',private.paid_order_invoice_items(COALESCE((
    SELECT jsonb_agg(to_jsonb(i)) FROM public.order_items i WHERE i.order_id = o.id
  ),'[]'::jsonb),p_include_fulfillment),
  'payments',COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',t.id,'amount',t.amount,'created_at',t.created_at,'description',t.description,
      'gateway',t.gateway,'status',t.status,'transaction_type',t.transaction_type,
      'payment_method',t.metadata->>'payment_method'
    ) ORDER BY t.created_at,t.id) FROM public.transactions t
    WHERE t.order_id = o.id AND t.merchant_id = o.merchant_id AND t.transaction_type = 'payment'
      AND t.status IN ('completed','success')
  ),'[]'::jsonb),
  'sellerTax',(
    SELECT jsonb_build_object('registrationStatus',m.vat_registration_status,'rate',m.vat_rate)
    FROM public.merchants m WHERE m.id = o.merchant_id
  ),
  'taxSubtotals',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('vat_category_code',s.vat_category_code,
      'vat_rate',s.vat_rate,'taxable_amount',s.taxable_amount,'tax_amount',s.tax_amount,
      'exemption_reason',s.exemption_reason) ORDER BY s.id)
    FROM public.order_tax_subtotals s WHERE s.order_id = o.id
  ),'[]'::jsonb))
  FROM public.orders o WHERE o.id = p_order_id;
$$;

-- The only supported amendments are zero-tax; keep historical classification
-- and calculate the new taxable base from the frozen replacement lines.
CREATE OR REPLACE FUNCTION private.pin_paid_order_revised_tax(p_inputs jsonb,p_original jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH stored AS (
    SELECT * FROM jsonb_to_recordset(COALESCE(p_original->'taxSubtotals','[]'::jsonb))
      AS t(vat_category_code text,vat_rate numeric,exemption_reason text)
  ), fallback AS (
    SELECT min(vat_category_code) AS category,min(vat_rate) AS rate FROM stored HAVING count(*)=1
  ), line AS (
    SELECT COALESCE((SELECT category FROM fallback),
      NULLIF(btrim(original_line->>'vat_category_code'),''),
      NULLIF(btrim(i->>'vat_category_code'),'')) AS category,
      COALESCE((SELECT rate FROM fallback),(original_line->>'vat_rate')::numeric,(i->>'vat_rate')::numeric,0) AS rate,
      COALESCE((i->>'line_extension_amount')::numeric,(i->>'price')::numeric*(i->>'quantity')::integer,0) AS taxable,
      COALESCE((i->>'vat_amount')::numeric,0) AS tax
    FROM jsonb_array_elements(p_inputs->'items') i
    LEFT JOIN jsonb_array_elements(p_original->'items') original_line ON original_line->>'id' = i->>'id'
  ), totals AS (
    SELECT category,rate,sum(taxable) AS taxable,sum(tax) AS tax
    FROM line WHERE category IS NOT NULL GROUP BY category,rate
  )
  SELECT p_inputs || jsonb_build_object(
    'sellerTax',COALESCE(p_original->'sellerTax',p_inputs->'sellerTax'),
    'revisedTaxPinned',true,
    'taxSubtotals',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'vat_category_code',t.category,'vat_rate',t.rate,'taxable_amount',t.taxable,'tax_amount',t.tax,
        'exemption_reason',COALESCE((SELECT min(s.exemption_reason) FROM stored s
          WHERE s.vat_category_code=t.category AND s.vat_rate=t.rate),
          CASE WHEN t.category='O' THEN 'Outside scope of VAT' END)) ORDER BY t.category,t.rate)
      FROM totals t
    ),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION private.pin_paid_order_revised_tax(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.enqueue_paid_order_amendment_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
  active_revision uuid;
  document uuid;
  snapshot_inputs jsonb;
  net_refunded numeric;
BEGIN
  IF NEW.event_type NOT IN ('confirmed','top_up_recorded','customer_refund_verified',
    'merchant_adjustment_applied','reversed','cancelled_for_recovery') THEN RETURN NEW; END IF;
  SELECT * INTO STRICT a FROM private.paid_order_amendments WHERE id = NEW.amendment_id;
  SELECT id INTO STRICT active_revision FROM private.paid_order_amendment_revisions
    WHERE amendment_id = a.id ORDER BY revision DESC LIMIT 1;
  snapshot_inputs := private.paid_order_invoice_snapshot(a.order_id);
  SELECT private.pin_paid_order_revised_tax(snapshot_inputs,r.original_document_inputs->'invoice')
    INTO STRICT snapshot_inputs
    FROM private.paid_order_amendment_revisions r WHERE r.amendment_id = a.id AND r.revision = 1;
  SELECT COALESCE(sum(amount_minor),0)/100 INTO net_refunded FROM private.paid_order_amendment_refunds
    WHERE amendment_id = a.id AND state = 'processed';
  -- The document shows customer net paid. The compatibility ledger retains gross.
  snapshot_inputs := jsonb_set(snapshot_inputs,'{order,amount_paid}',to_jsonb((snapshot_inputs#>>'{order,amount_paid}')::numeric - net_refunded));
  INSERT INTO private.paid_order_amendment_documents(amendment_id,event_id,revision_id,document_number,inputs)
  SELECT a.id,NEW.id,active_revision,COALESCE(max(d.document_number),0)+1,snapshot_inputs
  FROM private.paid_order_amendment_documents d WHERE d.amendment_id = a.id RETURNING id INTO document;
  INSERT INTO private.paid_order_amendment_updates(event_id,document_id) VALUES (NEW.id,document);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_paid_order_amendment_document(p_order_id uuid,p_version text DEFAULT 'original')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  a private.paid_order_amendments%ROWTYPE;
  d private.paid_order_amendment_documents%ROWTYPE;
  snapshot jsonb;
  original_header jsonb;
  original_invoice jsonb;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT (
    private.can_access_paid_order_amendment(o.merchant_id,'view')
    OR private.can_access_paid_order_amendment(o.merchant_id,'edit')
    OR EXISTS (SELECT 1 FROM public.customers c
      WHERE c.id = o.customer_id AND c.merchant_id = o.merchant_id AND c.user_id = auth.uid() AND c.deleted_at IS NULL)
  ) THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO a FROM private.paid_order_amendments WHERE order_id = p_order_id;
  IF NOT FOUND THEN
    IF p_version NOT IN ('current','original','live') THEN
      RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002';
    END IF;
    -- Return a coherent pre-amendment view even if confirmation races this read.
    IF o.source = 'online_store' THEN
      RETURN jsonb_build_object('inputs',private.paid_order_invoice_snapshot(p_order_id,true),'amendment',NULL,'documentNumber',NULL);
    END IF;
    RETURN NULL;
  END IF;
  IF p_version = 'live' THEN
    snapshot := private.paid_order_amendment_live_inputs(p_order_id,true);
  ELSIF p_version = 'current' THEN
    SELECT * INTO d FROM private.paid_order_amendment_documents
    WHERE amendment_id = a.id ORDER BY document_number DESC LIMIT 1;
    snapshot := COALESCE(d.inputs,private.paid_order_invoice_snapshot(p_order_id));
  ELSIF p_version = 'original' THEN
    SELECT original_document_inputs INTO STRICT snapshot FROM private.paid_order_amendment_revisions
    WHERE amendment_id = a.id AND revision = 1;
    original_header := snapshot->'order';
    snapshot := jsonb_build_object('order',COALESCE(snapshot#>'{invoice,order}',jsonb_build_object(
      'id',original_header->'id','order_number',original_header->'orderNumber','currency',original_header->'currency',
      'total',original_header->'total','subtotal',original_header->'subtotal','amount_paid',original_header->'amountPaid',
      'payment_status',original_header->'paymentStatus','created_at',original_header->'createdAt',
      'transaction_date',original_header->'transactionDate','invoice_issue_date',original_header->'invoiceIssueDate',
      'tax_point_date',original_header->'taxPointDate','invoice_type_code',original_header->'invoiceTypeCode',
      'customer_name',original_header->'customerName','customer_email',original_header->'customerEmail',
      'shipping_address',original_header->'shippingAddress','tax_amount',original_header->'taxAmount',
      'shipping_fee',original_header->'shippingFee','discount_amount',original_header->'discountAmount',
      'tax_exclusive_amount',original_header->'subtotal','tax_inclusive_amount',original_header->'total'
    )),'items',private.paid_order_invoice_items(snapshot->'items',true),
      'payments',COALESCE(snapshot#>'{invoice,payments}','[]'::jsonb),
      'taxSubtotals',snapshot#>'{invoice,taxSubtotals}',
      'sellerTax',snapshot#>'{invoice,sellerTax}');
  ELSE
    SELECT * INTO d FROM private.paid_order_amendment_documents
      WHERE amendment_id = a.id AND id::text = p_version;
    IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002'; END IF;
    snapshot := d.inputs;
  END IF;
  -- Preserve already-renderable snapshots. Older snapshots can be projected
  -- from their own frozen lines and the immutable initial tax metadata.
  IF p_version <> 'original' AND snapshot->>'revisedTaxPinned' IS DISTINCT FROM 'true' THEN
    SELECT r.original_document_inputs->'invoice' INTO original_invoice
    FROM private.paid_order_amendment_revisions r WHERE r.amendment_id = a.id AND r.revision = 1;
    snapshot := private.pin_paid_order_revised_tax(snapshot,original_invoice);
  END IF;
  RETURN jsonb_build_object('inputs',snapshot,'amendment',private.paid_order_amendment_customer_status(p_order_id),
    'documentNumber',COALESCE(d.document_number,CASE WHEN p_version = 'current' THEN 1 END));
END;
$$;

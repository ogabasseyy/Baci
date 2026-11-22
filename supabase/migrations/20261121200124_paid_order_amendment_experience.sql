CREATE TABLE private.paid_order_amendment_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amendment_id uuid NOT NULL REFERENCES private.paid_order_amendments(id),
  event_id bigint NOT NULL UNIQUE REFERENCES private.paid_order_amendment_events(id),
  revision_id uuid NOT NULL REFERENCES private.paid_order_amendment_revisions(id),
  document_number integer NOT NULL CHECK (document_number > 0),
  inputs jsonb NOT NULL,
  UNIQUE (amendment_id,document_number)
);
CREATE TABLE private.paid_order_amendment_updates (
  event_id bigint PRIMARY KEY REFERENCES private.paid_order_amendment_events(id),
  document_id uuid NOT NULL UNIQUE REFERENCES private.paid_order_amendment_documents(id),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','dispatching','sent','skipped','outcome_unknown')),
  claim uuid UNIQUE,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX paid_order_amendment_updates_pending
  ON private.paid_order_amendment_updates(created_at,event_id) WHERE state = 'pending';
ALTER TABLE private.paid_order_amendment_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.paid_order_amendment_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.paid_order_amendment_documents,private.paid_order_amendment_updates
FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER paid_order_amendment_documents_immutable BEFORE UPDATE OR DELETE
ON private.paid_order_amendment_documents FOR EACH ROW
EXECUTE FUNCTION private.reject_paid_order_amendment_history_rewrite();

-- One snapshot supplies the displayed items and the financial footer together.
-- These projections intentionally omit identifiers and fulfillment credentials.
CREATE FUNCTION private.paid_order_invoice_items(p_items jsonb,p_include_fulfillment boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg((
    SELECT jsonb_object_agg(key,value) FROM jsonb_each(i)
    WHERE key IN ('id','product_id','variant_id','condition','variant_name','name','item_description','quantity',
      'price','assurance_fee','line_extension_amount','line_id','unit_code','vat_category_code','vat_rate',
      'vat_amount','sellers_item_id','image_url')
      OR (p_include_fulfillment AND key = 'fulfillment_data')
  ) ORDER BY i->>'line_id',i->>'id'),'[]'::jsonb)
  FROM jsonb_array_elements(p_items) i;
$$;

CREATE FUNCTION private.paid_order_invoice_snapshot(p_order_id uuid,p_include_fulfillment boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('order',(
    SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(o))
    WHERE key IN ('id','order_number','currency','total','subtotal','amount_paid','payment_status',
      'created_at','transaction_date','invoice_issue_date','tax_point_date','invoice_type_code','customer_name',
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
  ),'[]'::jsonb))
  FROM public.orders o WHERE o.id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION private.paid_order_document_inputs(p_order_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'order', jsonb_build_object('id', o.id, 'orderNumber', o.order_number, 'currency', o.currency,
      'total', o.total, 'subtotal', o.subtotal, 'amountPaid', o.amount_paid, 'paymentStatus', o.payment_status,
      'createdAt', o.created_at, 'transactionDate', o.transaction_date, 'taxBasis', o.tax_basis,
      'invoiceIssueDate', o.invoice_issue_date, 'taxPointDate', o.tax_point_date, 'invoiceTypeCode', o.invoice_type_code,
      'customerName', o.customer_name, 'customerEmail', o.customer_email, 'shippingAddress', o.shipping_address,
      'taxAmount', o.tax_amount, 'shippingFee', o.shipping_fee, 'discountAmount', o.discount_amount),
    'invoice', private.paid_order_invoice_snapshot(p_order_id,true),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)
      FROM public.order_items i WHERE i.order_id = o.id), '[]'::jsonb)
  ) FROM public.orders o WHERE o.id = p_order_id;
$$;

CREATE FUNCTION private.paid_order_amendment_customer_status(p_order_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('state',a.state,'holdFulfillment',a.hold_fulfillment,
    'balanceDueMinor',a.balance_due_minor,'refundOwedMinor',a.refund_owed_minor,
    'documentId',d.id,'documentNumber',d.document_number)
  FROM private.paid_order_amendments a
  LEFT JOIN LATERAL (
    SELECT id,document_number FROM private.paid_order_amendment_documents
    WHERE amendment_id = a.id ORDER BY document_number DESC LIMIT 1
  ) d ON true
  WHERE a.order_id = p_order_id;
$$;

CREATE FUNCTION private.enqueue_paid_order_amendment_update()
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
CREATE TRIGGER paid_order_amendment_enqueue_customer_update AFTER INSERT ON private.paid_order_amendment_events
FOR EACH ROW EXECUTE FUNCTION private.enqueue_paid_order_amendment_update();

CREATE FUNCTION private.paid_order_amendment_live_inputs(p_order_id uuid,p_include_fulfillment boolean)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_set(s,'{order,amount_paid}',to_jsonb(greatest(0,
    COALESCE((s#>>'{order,amount_paid}')::numeric,0) - COALESCE((
      SELECT sum(t.amount) FROM public.transactions t WHERE t.order_id = p_order_id
        AND t.transaction_type = 'refund' AND t.status IN ('completed','refunded')
        AND ((lower(t.gateway) <> 'paystack' AND t.metadata->>'method' IS DISTINCT FROM 'paystack')
          OR t.metadata->>'provider_refund_status' = 'processed')
    ),0))))
  FROM private.paid_order_invoice_snapshot(p_order_id,p_include_fulfillment) s;
$$;

CREATE FUNCTION public.read_paid_order_amendment_document(p_order_id uuid,p_version text DEFAULT 'original')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  a private.paid_order_amendments%ROWTYPE;
  d private.paid_order_amendment_documents%ROWTYPE;
  snapshot jsonb;
  original_header jsonb;
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
      'payments',COALESCE(snapshot#>'{invoice,payments}','[]'::jsonb));
  ELSE
    SELECT * INTO d FROM private.paid_order_amendment_documents
      WHERE amendment_id = a.id AND id::text = p_version;
    IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002'; END IF;
    snapshot := d.inputs;
  END IF;
  RETURN jsonb_build_object('inputs',snapshot,'amendment',private.paid_order_amendment_customer_status(p_order_id),
    'documentNumber',COALESCE(d.document_number,CASE WHEN p_version = 'current' THEN 1 END));
END;
$$;

CREATE FUNCTION public.read_paid_order_amendment_tracking(
  p_order_id uuid,p_merchant_slug text,p_tracking_token text,p_email text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  status jsonb;
  projection jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.orders o JOIN public.merchants m ON m.id = o.merchant_id
    WHERE o.id = p_order_id AND m.slug = p_merchant_slug
      AND (public.verify_order_tracking_token(o.id,p_tracking_token) OR
        (p_email IS NOT NULL AND btrim(p_email) <> '' AND lower(btrim(o.customer_email)) = lower(btrim(p_email))))
  ) THEN RETURN NULL; END IF;
  status := private.paid_order_amendment_customer_status(p_order_id);
  IF status IS NULL THEN RETURN NULL; END IF;
  projection := private.paid_order_amendment_live_inputs(p_order_id,false);
  RETURN status || jsonb_build_object(
    'order',jsonb_build_object('total',projection#>'{order,total}','subtotal',projection#>'{order,subtotal}',
      'amount_paid',projection#>'{order,amount_paid}','payment_status',projection#>'{order,payment_status}'),
    'items',projection->'items'
  );
END;
$$;

REVOKE ALL ON FUNCTION private.paid_order_invoice_items(jsonb,boolean),private.paid_order_invoice_snapshot(uuid,boolean),
  private.paid_order_amendment_live_inputs(uuid,boolean),private.paid_order_amendment_customer_status(uuid),private.enqueue_paid_order_amendment_update(),
  public.read_paid_order_amendment_document(uuid,text),public.read_paid_order_amendment_tracking(uuid,text,text,text)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_paid_order_amendment_document(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_paid_order_amendment_tracking(uuid,text,text,text) TO anon,authenticated;

CREATE FUNCTION public.list_due_paid_order_amendment_updates(p_limit integer)
RETURNS SETOF text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_update_worker_required' USING ERRCODE = '42501';
  END IF;
  UPDATE private.paid_order_amendment_updates SET state = 'outcome_unknown'
    WHERE state = 'dispatching' AND claimed_at < clock_timestamp() - interval '15 minutes';
  RETURN QUERY SELECT u.event_id::text FROM private.paid_order_amendment_updates u
    WHERE u.state = 'pending' ORDER BY u.created_at,u.event_id LIMIT greatest(0,least(p_limit,20));
END;
$$;

CREATE FUNCTION public.claim_paid_order_amendment_update(p_event_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  m public.merchants%ROWTYPE;
  a private.paid_order_amendments%ROWTYPE;
  u private.paid_order_amendment_updates%ROWTYPE;
  d private.paid_order_amendment_documents%ROWTYPE;
  event_type text;
  claim_token uuid := gen_random_uuid();
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_update_worker_required' USING ERRCODE = '42501';
  END IF;
  SELECT a0.* INTO a FROM private.paid_order_amendments a0 JOIN private.paid_order_amendment_events e
    ON e.amendment_id = a0.id WHERE e.id = p_event_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || a.order_id,0));
  SELECT * INTO o FROM public.orders WHERE id = a.order_id FOR UPDATE;
  SELECT * INTO u FROM private.paid_order_amendment_updates WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND OR u.state <> 'pending' THEN RETURN NULL; END IF;
  SELECT e.event_type INTO event_type FROM private.paid_order_amendment_events e WHERE e.id = p_event_id;
  SELECT * INTO d FROM private.paid_order_amendment_documents WHERE id = u.document_id;
  IF EXISTS (SELECT 1 FROM private.paid_order_amendment_documents newer
    WHERE newer.amendment_id = a.id AND newer.document_number > d.document_number)
    OR (o.cancelled_at IS NOT NULL AND event_type <> 'cancelled_for_recovery')
    OR NULLIF(btrim(o.customer_email),'') IS NULL THEN
    UPDATE private.paid_order_amendment_updates SET state = 'skipped' WHERE event_id = p_event_id;
    RETURN NULL;
  END IF;
  SELECT * INTO m FROM public.merchants WHERE id = a.merchant_id;
  UPDATE private.paid_order_amendment_updates SET state = 'dispatching',claim = claim_token,claimed_at = clock_timestamp()
    WHERE event_id = p_event_id;
  RETURN jsonb_build_object('claim',claim_token,'orderId',o.id,'merchantId',m.id,'customerId',o.customer_id,
    'email',o.customer_email,'merchantName',m.business_name,'merchantSlug',m.slug,
    'orderNumber',o.order_number,'trackingToken',o.tracking_token,'eventType',event_type,
    'status',private.paid_order_amendment_customer_status(o.id),'documentId',d.id);
END;
$$;

CREATE FUNCTION public.complete_paid_order_amendment_update(p_claim uuid,p_sent boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_update_worker_required' USING ERRCODE = '42501';
  END IF;
  UPDATE private.paid_order_amendment_updates SET state = CASE WHEN p_sent THEN 'sent' ELSE 'outcome_unknown' END
    WHERE claim = p_claim AND state = 'dispatching';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.list_due_paid_order_amendment_updates(integer),public.claim_paid_order_amendment_update(bigint),
  public.complete_paid_order_amendment_update(uuid,boolean)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_due_paid_order_amendment_updates(integer),
  public.claim_paid_order_amendment_update(bigint),public.complete_paid_order_amendment_update(uuid,boolean) TO service_role;

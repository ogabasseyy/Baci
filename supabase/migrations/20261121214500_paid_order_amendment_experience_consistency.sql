-- Hold the order status and timeline timestamps in the same snapshot as its items and money.
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
  ),'[]'::jsonb))
  FROM public.orders o WHERE o.id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION public.read_paid_order_amendment_tracking(
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
      'amount_paid',projection#>'{order,amount_paid}','payment_status',projection#>'{order,payment_status}',
      'shipping_status',projection#>'{order,shipping_status}','updated_at',projection#>'{order,updated_at}',
      'paid_at',projection#>'{order,paid_at}','shipped_at',projection#>'{order,shipped_at}',
      'delivered_at',projection#>'{order,delivered_at}','cancelled_at',projection#>'{order,cancelled_at}'),
    'items',projection->'items'
  );
END;
$$;

-- A staff member can reconcile their own submitted confirmation without seeing another actor's key.
CREATE OR REPLACE FUNCTION public.read_paid_order_amendment_workspace(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  result jsonb;
  edit_allowed boolean;
  refund_allowed boolean;
  a private.paid_order_amendments%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  result := public.read_paid_order_amendment(p_order_id);
  edit_allowed := private.can_access_paid_order_amendment(o.merchant_id,'edit');
  refund_allowed := edit_allowed AND private.can_access_paid_order_amendment(o.merchant_id,'refund');
  SELECT * INTO a FROM private.paid_order_amendments WHERE order_id = o.id;
  RETURN result || jsonb_build_object(
    'canStart',edit_allowed AND a.id IS NULL AND o.source = 'online_store'
      AND o.payment_status = 'paid' AND o.shipping_status IN ('pending','processing')
      AND o.cancelled_at IS NULL AND o.shipment_id IS NULL AND o.shipment_booking_lock_token IS NULL
      AND EXISTS (SELECT 1 FROM private.paid_order_amendment_config
        WHERE merchant_id = o.merchant_id AND enabled AND cardinality(scenarios) > 0),
    'canEdit',edit_allowed,'canRefund',refund_allowed,
    'confirmationKey',CASE WHEN edit_allowed AND a.actor_id = auth.uid() THEN a.idempotency_key END,
    'customer',private.paid_order_amendment_customer_status(o.id),
    'refunds',CASE WHEN refund_allowed THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',r.id,'state',r.state,'amountMinor',r.amount_minor)
        ORDER BY r.created_at DESC,r.id DESC)
      FROM private.paid_order_amendment_refunds r WHERE r.amendment_id = a.id
    ),'[]'::jsonb) ELSE '[]'::jsonb END,
    'bankEvidence',CASE WHEN edit_allowed AND a.id IS NOT NULL THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',q.id,'amountMinor',q.amount_minor,'status',q.allocation,
        'transactionId',q.transaction_id,'occurredAt',q.occurred_at))
      FROM (SELECT e.* FROM private.paid_order_bank_evidence e
        WHERE e.merchant_id = o.merchant_id AND e.direction = 'incoming' AND (
          (e.order_id = o.id AND e.allocation IN ('unapplied','top_up'))
          OR (e.allocation IS NULL AND e.bound_order_id = o.id)
        ) ORDER BY e.occurred_at DESC,e.id LIMIT 30) q
    ),'[]'::jsonb) ELSE '[]'::jsonb END
  );
END;
$$;

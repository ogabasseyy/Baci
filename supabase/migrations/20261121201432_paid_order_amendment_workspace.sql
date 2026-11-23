CREATE FUNCTION public.read_paid_order_amendment_workspace(p_order_id uuid)
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

CREATE FUNCTION public.search_paid_order_amendment_replacements(p_order_id uuid,p_line_id uuid,p_search text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  merchant uuid;
  line public.order_items%ROWTYPE;
  search text := lower(btrim(p_search));
BEGIN
  SELECT o.merchant_id INTO merchant FROM public.orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT private.can_access_paid_order_amendment(merchant,'edit') THEN
    RAISE EXCEPTION 'amendment_forbidden' USING ERRCODE = '42501';
  END IF;
  IF search IS NULL OR length(search) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'invalid_amendment_selection' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO line FROM public.order_items WHERE id = p_line_id AND order_id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN (
    WITH matching AS (
      SELECT p.* FROM public.products p WHERE p.merchant_id = merchant AND p.status = 'active'
        AND p.taxable = false AND (strpos(lower(p.name),search)>0 OR strpos(lower(COALESCE(p.sku,'')),search)>0)
      ORDER BY p.name,p.id LIMIT 30
    ), candidates AS (
      SELECT p.id,'product' kind,p.name label FROM matching p
      WHERE line.variant_id IS NULL AND line.product_offer_id IS NULL AND p.id <> line.product_id
        AND p.manage_stock AND NOT p.has_variants AND p.stock_quantity >= line.quantity
      UNION ALL
      SELECT v.id,'variant',p.name || COALESCE(' · ' || (
        SELECT string_agg(value,' / ' ORDER BY key) FROM jsonb_each_text(
          CASE WHEN jsonb_typeof(v.attributes) = 'object' THEN v.attributes ELSE '{}'::jsonb END)
      ),'') FROM matching p JOIN public.product_variants v ON v.product_id = p.id AND v.merchant_id = merchant
      WHERE line.variant_id IS NOT NULL AND line.product_offer_id IS NULL AND v.id <> line.variant_id
        AND NOT v.is_inventory_anchor
      UNION ALL
      SELECT v.id,'condition_offer',p.name || ' · ' || v.condition
      FROM matching p JOIN public.product_offers v ON v.product_id = p.id AND v.merchant_id = merchant
      WHERE line.product_offer_id IS NOT NULL AND v.id <> line.product_offer_id
        AND v.status = 'active' AND v.stock_quantity >= line.quantity
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(candidate) ORDER BY label,id),'[]'::jsonb)
    FROM (SELECT * FROM candidates ORDER BY label,id LIMIT 30) candidate
  );
END;
$$;

REVOKE ALL ON FUNCTION public.read_paid_order_amendment_workspace(uuid),
  public.search_paid_order_amendment_replacements(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_paid_order_amendment_workspace(uuid),
  public.search_paid_order_amendment_replacements(uuid,uuid,text) TO authenticated;

-- Record only authenticated, owned, durable ledger debits. A failed projection
-- must stop checkout before a provider can sign/charge an unreduced order total.
CREATE FUNCTION public.record_order_store_credit(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o record; wallet numeric; savings numeric;
BEGIN
 IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Store credit unavailable' USING ERRCODE='42501';
 END IF;
 -- Match payment, wallet and savings writer locks. Never wait while holding a
 -- competing ledger/order lock; an interrupted request can safely retry.
 IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
 OR NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:'||p_order_id::text,0))
 OR NOT pg_catalog.pg_try_advisory_xact_lock(('x'||pg_catalog.substr(pg_catalog.md5(p_order_id::text),1,16))::bit(64)::bigint)
 OR NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('customer_savings_redemption:'||p_order_id::text,0)) THEN
  RAISE EXCEPTION 'Store credit retry required' USING ERRCODE='40001';
 END IF;
 SELECT r.id,r.merchant_id,r.customer_id,r.total,r.currency,r.amount_paid,r.wallet_amount_used,
  r.payment_status,r.shipping_status,r.cancelled_at INTO o
 FROM public.orders r JOIN public.customers c ON c.id=r.customer_id AND c.merchant_id=r.merchant_id
 WHERE r.id=p_order_id AND c.user_id=auth.uid() FOR UPDATE OF r FOR SHARE OF c;
 IF NOT FOUND THEN RAISE EXCEPTION 'Store credit unavailable' USING ERRCODE='42501'; END IF;
 IF o.currency IS DISTINCT FROM 'NGN' OR (o.total IS NULL OR o.total<=0 OR o.total::text IN ('NaN','Infinity','-Infinity')) OR o.cancelled_at IS NOT NULL
 OR o.shipping_status IN ('cancelled','canceled')
 OR o.payment_status IS NULL OR o.payment_status NOT IN ('unpaid','pending','partially_paid','bnpl_pending','bnpl_approved') THEN
  RAISE EXCEPTION 'Store credit unavailable' USING ERRCODE='23514';
 END IF;
 -- A row from a different customer/merchant or a reversed debit cannot fund
 -- this invoice. Do not erase historical debit/refund evidence to make it fit.
 IF EXISTS (SELECT 1 FROM public.customer_wallet_transactions t WHERE t.source_id=o.id
   AND t.source_type IN ('order_redemption','order_refund','order_reversal') AND
   (t.source_type<>'order_redemption' OR t.type IS DISTINCT FROM 'redemption' OR t.status IS DISTINCT FROM 'completed' OR t.amount IS NULL OR t.amount<=0
    OR t.customer_id IS DISTINCT FROM o.customer_id OR t.merchant_id IS DISTINCT FROM o.merchant_id))
 OR EXISTS (SELECT 1 FROM public.customer_savings_redemptions s WHERE s.order_id=o.id AND
   (s.customer_id IS DISTINCT FROM o.customer_id OR s.merchant_id IS DISTINCT FROM o.merchant_id
    OR s.amount IS NULL OR s.amount<=0 OR s.metadata->>'reversed_at' IS NOT NULL)) THEN
  RAISE EXCEPTION 'Store credit unavailable' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(t.amount),0) INTO wallet FROM public.customer_wallet_transactions t
 WHERE t.source_id=o.id AND t.source_type='order_redemption' AND t.type='redemption' AND t.status='completed';
 SELECT coalesce(sum(s.amount),0) INTO savings FROM public.customer_savings_redemptions s WHERE s.order_id=o.id;
 IF wallet+savings<=0 OR wallet+savings>=o.total THEN
  -- Zero-due orders use the existing wallet/store-credit finalizers instead.
  RAISE EXCEPTION 'Store credit unavailable' USING ERRCODE='23514';
 END IF;
 IF coalesce(o.amount_paid,0)=wallet+savings AND coalesce(o.wallet_amount_used,0)=wallet THEN
  RETURN jsonb_build_object('wallet',wallet,'savings',savings);
 END IF;
 IF o.payment_status IS NULL OR o.payment_status NOT IN ('unpaid','pending')
 OR coalesce(o.amount_paid,0)<>0 OR coalesce(o.wallet_amount_used,0)<>0
 OR EXISTS (SELECT 1 FROM public.transactions t WHERE t.order_id=o.id AND t.transaction_type='payment') THEN
  RAISE EXCEPTION 'Store credit reconciliation required' USING ERRCODE='40001';
 END IF;
 UPDATE public.orders SET amount_paid=wallet+savings,wallet_amount_used=wallet WHERE id=o.id;
 RETURN jsonb_build_object('wallet',wallet,'savings',savings);
END $$;
REVOKE ALL ON FUNCTION public.record_order_store_credit(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_order_store_credit(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';

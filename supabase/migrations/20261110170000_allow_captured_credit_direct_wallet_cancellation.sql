CREATE OR REPLACE FUNCTION credit_direct_private.guard_wallet_attempt_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_order uuid; new_order uuid; target uuid; a credit_direct_private.wallet_attempts%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='customer_wallet_transactions' THEN
  IF TG_OP<>'INSERT' AND OLD.source_type IN ('order_redemption','order_refund','order_reversal') THEN old_order:=OLD.source_id; END IF;
  IF TG_OP<>'DELETE' AND NEW.source_type IN ('order_redemption','order_refund','order_reversal') THEN new_order:=NEW.source_id; END IF;
 ELSE
  IF TG_OP<>'INSERT' THEN old_order:=OLD.order_id; END IF;
  IF TG_OP<>'DELETE' THEN new_order:=NEW.order_id; END IF;
 END IF;
 FOR target IN SELECT DISTINCT x FROM unnest(ARRAY[old_order,new_order]) t(x) WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM credit_direct_private.lock_wallet_attempt(target);
  SELECT * INTO a FROM credit_direct_private.wallet_attempts WHERE order_id=target;
  IF FOUND THEN
   -- cancel_order_as_merchant stamps the order before it invokes the
   -- restricted reverse_wallet_redemption RPC. Match the original debit
   -- and the same owner/staff permission used by the cancellation RPC.
   IF a.merchant_capture_reference IS NOT NULL
    AND TG_TABLE_NAME='customer_wallet_transactions' AND TG_OP='INSERT'
    AND auth.role()='authenticated' AND auth.uid() IS NOT NULL THEN
    IF NEW.source_type='order_reversal' AND NEW.type='adjustment' AND NEW.status='completed'
     AND NEW.amount=a.wallet_amount AND NEW.customer_id=a.customer_id AND NEW.merchant_id=a.merchant_id
     AND EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.merchants m ON m.id=o.merchant_id
      WHERE o.id=target AND o.merchant_id=a.merchant_id AND o.customer_id=a.customer_id
       AND o.shipping_status='cancelled' AND o.cancelled_at IS NOT NULL AND o.cancelled_by='merchant'
       AND (m.user_id=auth.uid() OR public.check_staff_permission(auth.uid(),o.merchant_id,'orders','edit'))
     )
     AND EXISTS (
      SELECT 1 FROM public.customer_wallet_transactions debit
      JOIN public.customer_wallets wallet ON wallet.id=debit.wallet_id
      WHERE debit.source_id=target AND debit.source_type='order_redemption'
       AND debit.type='redemption' AND debit.status='completed'
       AND debit.amount=NEW.amount AND debit.wallet_id=NEW.wallet_id
       AND debit.customer_id=a.customer_id AND debit.merchant_id=a.merchant_id
       AND wallet.customer_id=a.customer_id AND wallet.merchant_id=a.merchant_id
     )
     AND NOT EXISTS (
      SELECT 1 FROM public.customer_wallet_transactions reversal
      WHERE reversal.source_id=target AND reversal.source_type IN ('order_reversal','order_refund')
     ) THEN
     CONTINUE;
    END IF;
   END IF;
   IF auth.role() IS DISTINCT FROM 'service_role' OR a.merchant_capture_reference IS NULL THEN
    RAISE EXCEPTION 'credit_direct_wallet_attempt_pending' USING ERRCODE='23514';
   END IF;
  ELSIF TG_OP='INSERT' AND (TG_TABLE_NAME='customer_savings_redemptions' OR to_jsonb(NEW)->>'source_type'='order_redemption') AND EXISTS(SELECT 1 FROM public.orders WHERE id=target AND payment_method='credit_direct'
   AND (payment_status IN ('bnpl_pending','bnpl_approved','paid') OR notes LIKE '%creditDirectSessionId%')) THEN
   RAISE EXCEPTION 'credit_direct_wallet_attempt_pending' USING ERRCODE='23514';
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION credit_direct_private.guard_wallet_attempt_ledger()
 FROM PUBLIC,anon,authenticated,service_role;

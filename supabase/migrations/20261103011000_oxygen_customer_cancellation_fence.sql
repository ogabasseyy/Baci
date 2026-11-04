-- Oxygen financing is not represented by ordinary payment transactions. Keep
-- customer cancellation unavailable while the order remains bound to Oxygen.
CREATE OR REPLACE FUNCTION private.order_customer_cancellable(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT o.payment_status = 'unpaid'
    AND o.shipping_status IN ('pending', 'processing')
    AND NOT EXISTS (
      SELECT 1 FROM public.transactions t WHERE t.order_id = p_order_id
        AND t.transaction_type = 'payment'
        AND t.status IN ('pending', 'processing', 'completed')
    )
    AND NOT (o.payment_method IS NOT DISTINCT FROM 'oxygen' AND EXISTS (
      SELECT 1 FROM public.oxygen_workflows w WHERE w.order_id = o.id
    ))
  FROM public.orders o WHERE o.id = p_order_id;
$$;

-- The predicate is a UI/read hint. The write boundary must also serialize
-- with workflow commands and creation, even when a caller uses stale state.
CREATE FUNCTION oxygen_private.guard_customer_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.cancelled_by = 'customer' AND NEW.shipping_status = 'cancelled'
    AND OLD.shipping_status IS DISTINCT FROM 'cancelled'
    AND OLD.payment_method = 'oxygen' THEN
    PERFORM 1 FROM public.oxygen_workflows WHERE order_id=OLD.id FOR UPDATE;
    IF FOUND THEN
      RAISE EXCEPTION 'order_not_cancellable' USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION oxygen_private.guard_customer_cancellation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER oxygen_customer_cancellation_fence
  BEFORE UPDATE OF shipping_status, cancelled_by ON public.orders
  FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_customer_cancellation();

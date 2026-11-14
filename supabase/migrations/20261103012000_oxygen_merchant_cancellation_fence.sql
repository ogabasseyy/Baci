-- Merchant cancellation has the same financing risk as customer cancellation.
CREATE OR REPLACE FUNCTION oxygen_private.guard_customer_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.cancelled_by IN ('customer','merchant') AND NEW.shipping_status = 'cancelled'
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

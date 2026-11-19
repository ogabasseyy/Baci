-- An Oxygen workflow is a durable financial record, including while a booking
-- outcome is unknown. Never repurpose its order for another payment method.
-- Locking the workflow also serializes this check with an in-flight command.
CREATE FUNCTION oxygen_private.guard_order_payment_method()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.payment_method = 'oxygen' AND NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
    PERFORM 1 FROM public.oxygen_workflows WHERE order_id = OLD.id FOR UPDATE;
    IF FOUND THEN
      RAISE EXCEPTION 'oxygen_payment_in_progress' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION oxygen_private.guard_order_payment_method() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER oxygen_order_payment_method_fence
  BEFORE UPDATE OF payment_method ON public.orders
  FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_order_payment_method();

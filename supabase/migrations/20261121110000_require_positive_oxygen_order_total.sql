-- Validate the final order amount inside the insert transaction so a pricing
-- change or discount cannot leave an Oxygen order that cannot start financing.
CREATE FUNCTION oxygen_private.require_positive_oxygen_order_total()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.total IS NULL OR NEW.total <= 0 THEN
    RAISE EXCEPTION 'oxygen_order_total_must_be_positive' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION oxygen_private.require_positive_oxygen_order_total() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER oxygen_positive_order_total
  BEFORE INSERT ON public.orders
  FOR EACH ROW WHEN (NEW.payment_method = 'oxygen')
  EXECUTE FUNCTION oxygen_private.require_positive_oxygen_order_total();

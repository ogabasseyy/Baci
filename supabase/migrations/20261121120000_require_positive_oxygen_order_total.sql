-- Validate the final order amount inside the insert transaction so a pricing
-- change or discount cannot leave an Oxygen order that cannot start financing.
CREATE FUNCTION oxygen_private.require_positive_oxygen_order_total()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Preserve updates to historical orders when the amount itself is unchanged.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.total IS NOT DISTINCT FROM OLD.total
      AND NEW.payment_method IS NOT DISTINCT FROM OLD.payment_method THEN
      RETURN NEW;
    END IF;
  END IF;
  -- The numeric(10,2) column also rejects infinity before the trigger runs.
  IF NEW.total IS NULL OR NEW.total <= 0
    OR NEW.total IN ('NaN'::numeric, 'Infinity'::numeric) THEN
    RAISE EXCEPTION 'oxygen_order_total_must_be_positive' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION oxygen_private.require_positive_oxygen_order_total() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER oxygen_positive_order_total
  BEFORE INSERT OR UPDATE OF total, payment_method ON public.orders
  FOR EACH ROW WHEN (NEW.payment_method = 'oxygen')
  EXECUTE FUNCTION oxygen_private.require_positive_oxygen_order_total();

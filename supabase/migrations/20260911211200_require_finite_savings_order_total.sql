CREATE OR REPLACE FUNCTION public.enforce_customer_savings_redemption_order_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_order_total numeric;
BEGIN
  SELECT o.total
  INTO v_order_total
  FROM public.orders AS o
  WHERE o.id = NEW.order_id
    AND o.customer_id = NEW.customer_id
    AND o.merchant_id = NEW.merchant_id
  FOR UPDATE;

  IF v_order_total IS NULL THEN
    RAISE EXCEPTION 'savings_goal_does_not_match_order' USING ERRCODE = 'P0001';
  END IF;
  IF v_order_total IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) THEN
    RAISE EXCEPTION 'savings_order_total_must_be_finite' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_savings_redemptions_order_total_finite
  ON public.customer_savings_redemptions;
CREATE TRIGGER trg_customer_savings_redemptions_order_total_finite
BEFORE INSERT OR UPDATE OF order_id, customer_id, merchant_id, amount
ON public.customer_savings_redemptions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_customer_savings_redemption_order_total();

REVOKE ALL ON FUNCTION public.enforce_customer_savings_redemption_order_total() FROM PUBLIC, anon;

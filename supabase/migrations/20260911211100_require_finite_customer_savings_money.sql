ALTER TABLE public.customer_savings_goals
  ADD CONSTRAINT customer_savings_goals_finite_amounts_check CHECK (
    target_amount NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    AND current_amount NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  ) NOT VALID;

ALTER TABLE public.customer_savings_redemptions
  ADD CONSTRAINT customer_savings_redemptions_finite_amount_check CHECK (
    amount NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.enforce_customer_savings_finite_money()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_catalogue_price numeric;
BEGIN
  IF TG_TABLE_NAME = 'customer_savings_goals' THEN
    IF NEW.target_amount IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
      OR NEW.current_amount IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    THEN
      RAISE EXCEPTION 'savings_amount_must_be_finite' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(v.price_override, p.price)
    INTO v_catalogue_price
    FROM public.products AS p
    LEFT JOIN public.product_variants AS v
      ON v.id = NEW.variant_id
      AND v.product_id = p.id
      AND v.merchant_id = p.merchant_id
    WHERE p.id = NEW.product_id
      AND p.merchant_id = NEW.merchant_id;

    IF v_catalogue_price IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) THEN
      RAISE EXCEPTION 'savings_catalogue_price_must_be_finite' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.amount IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) THEN
    RAISE EXCEPTION 'savings_redemption_amount_must_be_finite' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_savings_goals_finite_money
  ON public.customer_savings_goals;
CREATE TRIGGER trg_customer_savings_goals_finite_money
BEFORE INSERT OR UPDATE OF merchant_id, product_id, variant_id, target_amount, current_amount
ON public.customer_savings_goals
FOR EACH ROW
EXECUTE FUNCTION public.enforce_customer_savings_finite_money();

DROP TRIGGER IF EXISTS trg_customer_savings_redemptions_finite_money
  ON public.customer_savings_redemptions;
CREATE TRIGGER trg_customer_savings_redemptions_finite_money
BEFORE INSERT OR UPDATE OF amount
ON public.customer_savings_redemptions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_customer_savings_finite_money();

REVOKE ALL ON FUNCTION public.enforce_customer_savings_finite_money() FROM PUBLIC, anon;

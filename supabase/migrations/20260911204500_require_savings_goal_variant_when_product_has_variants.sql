-- Require an exact catalogue variant for new or retargeted savings goals when
-- the selected product has variants. Legacy goals with a null variant_id are
-- left unchanged until product_id/variant_id/merchant_id is updated.

CREATE OR REPLACE FUNCTION public.enforce_customer_savings_goal_variant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.variant_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.product_variants v
      WHERE v.product_id = NEW.product_id
        AND v.merchant_id = NEW.merchant_id
    )
  THEN
    RAISE EXCEPTION 'variant_required_for_savings'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.variant_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.product_variants v
      WHERE v.id = NEW.variant_id
        AND v.product_id = NEW.product_id
        AND v.merchant_id = NEW.merchant_id
    )
  THEN
    RAISE EXCEPTION 'variant_not_available_for_savings'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_savings_goals_require_variant
  ON public.customer_savings_goals;

CREATE TRIGGER trg_customer_savings_goals_require_variant
BEFORE INSERT OR UPDATE OF merchant_id, product_id, variant_id
ON public.customer_savings_goals
FOR EACH ROW
EXECUTE FUNCTION public.enforce_customer_savings_goal_variant();

REVOKE ALL ON FUNCTION public.enforce_customer_savings_goal_variant() FROM PUBLIC, anon;

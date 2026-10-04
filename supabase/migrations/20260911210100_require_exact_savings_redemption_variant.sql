CREATE OR REPLACE FUNCTION public.enforce_customer_savings_redemption_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_goal record;
BEGIN
  SELECT g.id, g.product_id, g.variant_id
  INTO v_goal
  FROM public.customer_savings_goals g
  WHERE g.id = NEW.goal_id
    AND g.customer_id = NEW.customer_id
    AND g.merchant_id = NEW.merchant_id;

  IF v_goal.id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = NEW.order_id
      AND o.customer_id = NEW.customer_id
      AND o.merchant_id = NEW.merchant_id
  ) THEN
    RAISE EXCEPTION 'savings_goal_does_not_match_order' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.order_items oi
    WHERE oi.order_id = NEW.order_id
      AND oi.product_id = v_goal.product_id
      AND (
        oi.variant_id = v_goal.variant_id
        OR (
          v_goal.variant_id IS NULL
          AND (
            oi.variant_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.product_variants v
              WHERE v.id = oi.variant_id
                AND v.product_id = v_goal.product_id
                AND v.merchant_id = NEW.merchant_id
                AND v.is_inventory_anchor IS TRUE
            )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'savings_goal_does_not_match_order' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_savings_redemptions_require_exact_variant
  ON public.customer_savings_redemptions;

CREATE TRIGGER trg_customer_savings_redemptions_require_exact_variant
BEFORE INSERT ON public.customer_savings_redemptions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_customer_savings_redemption_variant();

REVOKE ALL ON FUNCTION public.enforce_customer_savings_redemption_variant() FROM PUBLIC, anon;

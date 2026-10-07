CREATE OR REPLACE FUNCTION public.enforce_customer_savings_goal_variant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_product record;
  v_variant_id uuid;
  v_variant_condition text;
  v_variant_images jsonb;
  v_variant_primary_image text;
  v_variant_price numeric;
  v_variant_sku text;
  v_catalogue_price numeric;
  v_legacy_completed_selection boolean;
  v_same_selection boolean;
BEGIN
  v_legacy_completed_selection := TG_OP = 'UPDATE'
    AND OLD.status = 'completed'
    AND OLD.variant_id IS NULL
    AND NEW.variant_id IS NOT NULL
    AND NEW.merchant_id = OLD.merchant_id
    AND NEW.product_id = OLD.product_id
    AND NEW.target_amount = OLD.target_amount
    AND NEW.current_amount = OLD.current_amount;

  v_same_selection := TG_OP = 'UPDATE'
    AND NEW.merchant_id = OLD.merchant_id
    AND NEW.product_id = OLD.product_id
    AND NEW.variant_id IS NOT DISTINCT FROM OLD.variant_id
    AND NEW.target_amount = OLD.target_amount;

  IF v_same_selection AND NEW.product_snapshot IS NOT DISTINCT FROM OLD.product_snapshot THEN
    RETURN NEW;
  END IF;

  SELECT p.id, p.name, p.price, p.images, p.condition
  INTO v_product
  FROM public.products AS p
  WHERE p.id = NEW.product_id
    AND p.merchant_id = NEW.merchant_id
    AND p.status = 'active';

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'product_not_available_for_savings' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.variant_id IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.product_variants AS v
      WHERE v.product_id = NEW.product_id
        AND v.merchant_id = NEW.merchant_id
        AND v.is_inventory_anchor IS NOT TRUE
    ) THEN
      RAISE EXCEPTION 'variant_required_for_savings' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT v.id, v.condition, v.images, v.primary_image, v.price_override, v.sku
    INTO v_variant_id, v_variant_condition, v_variant_images, v_variant_primary_image,
      v_variant_price, v_variant_sku
    FROM public.product_variants AS v
    WHERE v.id = NEW.variant_id
      AND v.product_id = NEW.product_id
      AND v.merchant_id = NEW.merchant_id
      AND v.is_inventory_anchor IS NOT TRUE;

    IF v_variant_id IS NULL THEN
      RAISE EXCEPTION 'variant_not_available_for_savings' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_legacy_completed_selection THEN
    v_catalogue_price := COALESCE(v_variant_price, v_product.price);
    IF v_catalogue_price IS NULL OR v_catalogue_price <= 0
      OR v_catalogue_price > LEAST(NEW.current_amount, NEW.target_amount)
    THEN
      RAISE EXCEPTION 'legacy_savings_goal_variant_exceeds_locked_amount'
        USING ERRCODE = '22023';
    END IF;

    NEW.product_snapshot := COALESCE(OLD.product_snapshot, '{}'::jsonb)
      || jsonb_build_object(
        'condition', COALESCE(v_variant_condition, v_product.condition),
        'image', COALESCE(v_variant_primary_image, v_variant_images ->> 0, v_product.images ->> 0), 'name', v_product.name,
        'price', OLD.target_amount,
        'selectionStatus', 'exact',
        'variantId', NEW.variant_id,
        'variantLabel', v_variant_sku
      );
    RETURN NEW;
  END IF;

  IF v_same_selection THEN
    NEW.product_snapshot := COALESCE(OLD.product_snapshot, '{}'::jsonb)
      || jsonb_build_object(
        'condition', COALESCE(v_variant_condition, v_product.condition),
        'image', COALESCE(v_variant_primary_image, v_variant_images ->> 0, v_product.images ->> 0), 'name', v_product.name,
        'price', OLD.target_amount,
        'selectionStatus', 'exact',
        'variantId', NEW.variant_id,
        'variantLabel', v_variant_sku
      );
    RETURN NEW;
  END IF;

  v_catalogue_price := COALESCE(v_variant_price, v_product.price);
  IF v_catalogue_price IS NULL OR v_catalogue_price <= 0 THEN
    RAISE EXCEPTION 'savings_device_price_not_available' USING ERRCODE = '22023';
  END IF;
  IF NEW.target_amount < v_catalogue_price THEN
    RAISE EXCEPTION 'target_amount_below_catalogue_price' USING ERRCODE = '22023';
  END IF;

  NEW.product_snapshot := jsonb_build_object(
    'condition', COALESCE(v_variant_condition, v_product.condition),
    'image', COALESCE(v_variant_primary_image, v_variant_images ->> 0, v_product.images ->> 0),
    'name', v_product.name,
    'price', NEW.target_amount,
    'cataloguePrice', v_catalogue_price,
    'selectionStatus', 'exact',
    'variantId', NEW.variant_id,
    'variantLabel', v_variant_sku
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_savings_goals_require_variant
  ON public.customer_savings_goals;

CREATE TRIGGER trg_customer_savings_goals_require_variant
BEFORE INSERT OR UPDATE OF merchant_id, product_id, variant_id, product_snapshot, target_amount
ON public.customer_savings_goals
FOR EACH ROW
EXECUTE FUNCTION public.enforce_customer_savings_goal_variant();

CREATE OR REPLACE FUNCTION public.resolve_completed_customer_savings_goal_variant(
  p_goal_id uuid,
  p_customer_id uuid,
  p_merchant_id uuid,
  p_actor_id uuid,
  p_variant_id uuid
) RETURNS TABLE(success boolean, goal_id uuid, goal_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_goal record;
  v_catalogue_price numeric;
BEGIN
  IF p_goal_id IS NULL OR p_customer_id IS NULL OR p_merchant_id IS NULL
    OR p_actor_id IS NULL OR p_variant_id IS NULL THEN
    RAISE EXCEPTION 'completed_savings_goal_variant_selection_arguments_required'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
    END IF;
    IF p_actor_id IS DISTINCT FROM auth.uid()
      OR NOT EXISTS (
        SELECT 1 FROM public.customers AS c
        WHERE c.id = p_customer_id
          AND c.merchant_id = p_merchant_id
          AND c.user_id = auth.uid()
      ) THEN
      RAISE EXCEPTION 'not_authorized_for_customer_savings' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT g.id, g.product_id, g.variant_id, g.status, g.applied_order_id,
    g.current_amount, g.target_amount
  INTO v_goal
  FROM public.customer_savings_goals AS g
  WHERE g.id = p_goal_id
    AND g.customer_id = p_customer_id
    AND g.merchant_id = p_merchant_id
  FOR UPDATE;

  IF v_goal.id IS NULL THEN
    RAISE EXCEPTION 'savings_goal_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_goal.status <> 'completed'
    OR v_goal.variant_id IS NOT NULL
    OR v_goal.applied_order_id IS NOT NULL
    OR v_goal.current_amount <= 0 THEN
    RAISE EXCEPTION 'savings_goal_not_legacy_variant_recoverable' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(v.price_override, p.price)
  INTO v_catalogue_price
  FROM public.product_variants AS v
  JOIN public.products AS p ON p.id = v.product_id AND p.merchant_id = v.merchant_id
  WHERE v.id = p_variant_id
    AND v.product_id = v_goal.product_id
    AND v.merchant_id = p_merchant_id
    AND v.is_inventory_anchor IS NOT TRUE
    AND p.status = 'active';

  IF v_catalogue_price IS NULL OR v_catalogue_price <= 0
    OR v_catalogue_price > LEAST(v_goal.current_amount, v_goal.target_amount)
  THEN
    RAISE EXCEPTION 'legacy_savings_goal_variant_exceeds_locked_amount'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.customer_savings_goals
  SET variant_id = p_variant_id, updated_at = now()
  WHERE id = p_goal_id;

  INSERT INTO public.customer_savings_events (
    goal_id, merchant_id, customer_id, event_type, actor_type, actor_id, metadata
  ) VALUES (
    p_goal_id, p_merchant_id, p_customer_id, 'legacy_completed_variant_selected',
    'customer', p_actor_id, jsonb_build_object('variant_id', p_variant_id)
  );

  RETURN QUERY SELECT true, p_goal_id, v_goal.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_customer_savings_redemption_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_goal record;
  v_order_total numeric;
  v_existing_redemptions numeric;
BEGIN
  SELECT g.id, g.product_id, g.variant_id
  INTO v_goal
  FROM public.customer_savings_goals AS g
  WHERE g.id = NEW.goal_id
    AND g.customer_id = NEW.customer_id
    AND g.merchant_id = NEW.merchant_id;

  SELECT o.total
  INTO v_order_total
  FROM public.orders AS o
  WHERE o.id = NEW.order_id
    AND o.customer_id = NEW.customer_id
    AND o.merchant_id = NEW.merchant_id
  FOR UPDATE;

  IF v_goal.id IS NULL OR v_order_total IS NULL THEN
    RAISE EXCEPTION 'savings_goal_does_not_match_order' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(r.amount), 0)
  INTO v_existing_redemptions
  FROM public.customer_savings_redemptions AS r
  WHERE r.order_id = NEW.order_id;

  IF NEW.amount + v_existing_redemptions > v_order_total THEN
    RAISE EXCEPTION 'savings_amount_exceeds_order_total' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.order_items AS oi
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
              FROM public.product_variants AS v
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

REVOKE ALL ON FUNCTION public.enforce_customer_savings_goal_variant() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_customer_savings_redemption_variant() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_completed_customer_savings_goal_variant(uuid, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_completed_customer_savings_goal_variant(uuid, uuid, uuid, uuid, uuid)
  TO authenticated, service_role;

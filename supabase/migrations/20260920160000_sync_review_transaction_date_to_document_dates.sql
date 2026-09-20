-- Syncs document dates when transaction review corrects the transaction date.
-- Identical to 20260702213000_update_transaction_review_unit_edit_lookup.sql
-- except the public.orders UPDATE, which additionally moves invoice_issue_date
-- and tax_point_date to the reviewer's selected calendar day (client timezone)
-- and marks both explicit. Required because manual orders carry explicit
-- device-local dates that the sync trigger preserves by design.
CREATE OR REPLACE FUNCTION public.update_transaction_review_details(
  p_merchant_id uuid,
  p_order_id uuid,
  p_order_item_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_cost_price numeric,
  p_supplier_name text,
  p_transaction_date timestamptz,
  p_client_timezone text DEFAULT NULL,
  p_update_product_default boolean DEFAULT false,
  p_unit_index integer DEFAULT NULL,
  p_identifier_type text DEFAULT NULL,
  p_identifier_value text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_identifier_type text := NULLIF(btrim(COALESCE(p_identifier_type, '')), '');
  v_identifier_value text := NULLIF(btrim(COALESCE(p_identifier_value, '')), '');
  v_order_item_product_id uuid;
  v_order_item_quantity integer;
  v_order_item_rows integer := 0;
  v_order_item_variant_id uuid;
  v_order_rows integer;
  v_product_rows integer;
  v_supplier_name text := btrim(COALESCE(p_supplier_name, ''));
  v_transaction_time_zone text := NULLIF(
    btrim(COALESCE(p_client_timezone, '')),
    ''
  );
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Merchant is required' USING ERRCODE = '22023';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Transaction is required' USING ERRCODE = '22023';
  END IF;

  IF p_order_item_id IS NULL THEN
    RAISE EXCEPTION 'Transaction line item is required' USING ERRCODE = '22023';
  END IF;

  IF p_cost_price IS NULL OR p_cost_price < 0 THEN
    RAISE EXCEPTION 'Cost price must be a non-negative number'
      USING ERRCODE = '22023';
  END IF;

  IF p_unit_index IS NOT NULL AND p_unit_index < 0 THEN
    RAISE EXCEPTION 'Unit index must be a non-negative integer'
      USING ERRCODE = '22023';
  END IF;

  IF v_identifier_type IS NOT NULL
     AND v_identifier_type NOT IN ('imei', 'serial') THEN
    RAISE EXCEPTION 'Identifier type must be imei or serial'
      USING ERRCODE = '22023';
  END IF;

  IF v_identifier_type IS NOT NULL AND v_identifier_value IS NULL THEN
    RAISE EXCEPTION 'Identifier value is required when identifier type is provided'
      USING ERRCODE = '22023';
  END IF;

  IF v_identifier_type IS NULL AND v_identifier_value IS NOT NULL THEN
    RAISE EXCEPTION 'Identifier type is required when identifier value is provided'
      USING ERRCODE = '22023';
  END IF;

  IF p_transaction_date IS NULL THEN
    RAISE EXCEPTION 'Transaction date is required' USING ERRCODE = '22023';
  END IF;

  IF v_transaction_time_zone IS NULL THEN
    v_transaction_time_zone := 'Africa/Lagos';
  END IF;

  PERFORM 1
  FROM pg_timezone_names
  WHERE name = v_transaction_time_zone;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction timezone is invalid' USING ERRCODE = '22023';
  END IF;

  IF (p_transaction_date AT TIME ZONE v_transaction_time_zone)::date >
     (now() AT TIME ZONE v_transaction_time_zone)::date THEN
    RAISE EXCEPTION 'Transaction date cannot be in the future'
      USING ERRCODE = '22023';
  END IF;

  IF p_unit_index IS NULL THEN
    UPDATE public.order_items AS oi
    SET
      cost_price = p_cost_price,
      supplier_name = NULLIF(v_supplier_name, '')
    FROM public.orders AS o
    WHERE oi.id = p_order_item_id
      AND oi.order_id = o.id
      AND o.id = p_order_id
      AND o.merchant_id = p_merchant_id
      AND (
        p_product_id IS NULL
        OR oi.product_id = p_product_id
      )
      AND (
        p_variant_id IS NULL
        OR oi.variant_id = p_variant_id
      )
    RETURNING oi.product_id, oi.variant_id, oi.quantity
    INTO v_order_item_product_id, v_order_item_variant_id, v_order_item_quantity;

    GET DIAGNOSTICS v_order_item_rows = ROW_COUNT;
  ELSE
    SELECT oi.product_id, oi.variant_id, oi.quantity
    INTO v_order_item_product_id, v_order_item_variant_id, v_order_item_quantity
    FROM public.order_items AS oi
    JOIN public.orders AS o ON o.id = oi.order_id
    WHERE oi.id = p_order_item_id
      AND o.id = p_order_id
      AND o.merchant_id = p_merchant_id
      AND (
        p_product_id IS NULL
        OR oi.product_id = p_product_id
      )
      AND (
        p_variant_id IS NULL
        OR oi.variant_id = p_variant_id
      )
    LIMIT 1;

    v_order_item_rows := CASE WHEN FOUND THEN 1 ELSE 0 END;
  END IF;

  IF v_order_item_rows = 0 THEN
    RAISE EXCEPTION 'Transaction line item not found for this merchant'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_unit_index IS NOT NULL
     AND p_unit_index >= COALESCE(v_order_item_quantity, 0) THEN
    RAISE EXCEPTION 'Unit index is out of range for this line item'
      USING ERRCODE = '22023';
  END IF;

  IF p_unit_index IS NOT NULL THEN
    INSERT INTO public.order_item_unit_costs (
      merchant_id,
      order_id,
      order_item_id,
      unit_index,
      cost_price,
      supplier_name,
      identifier_type,
      identifier_value
    ) VALUES (
      p_merchant_id,
      p_order_id,
      p_order_item_id,
      p_unit_index,
      p_cost_price,
      NULLIF(v_supplier_name, ''),
      v_identifier_type,
      v_identifier_value
    )
    ON CONFLICT (order_item_id, unit_index)
    DO UPDATE SET
      cost_price = EXCLUDED.cost_price,
      supplier_name = EXCLUDED.supplier_name,
      identifier_type = EXCLUDED.identifier_type,
      identifier_value = EXCLUDED.identifier_value,
      merchant_id = EXCLUDED.merchant_id,
      order_id = EXCLUDED.order_id,
      updated_at = now();
  END IF;

  IF p_update_product_default THEN
    IF p_product_id IS NULL THEN
      RAISE EXCEPTION 'Product is required to update the catalog default'
        USING ERRCODE = '22023';
    END IF;

    IF v_order_item_product_id IS DISTINCT FROM p_product_id THEN
      RAISE EXCEPTION 'Transaction line item is not linked to this product'
        USING ERRCODE = 'P0001';
    END IF;

    IF v_order_item_variant_id IS NOT NULL
       AND p_variant_id IS DISTINCT FROM v_order_item_variant_id THEN
      RAISE EXCEPTION 'Transaction line item is linked to a different variant'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- A transaction review is an explicit human date correction: when the
  -- transaction moves, both document dates follow the reviewer's selected
  -- calendar day (client timezone, defaulting to Africa/Lagos above) and
  -- their provenance becomes explicit. Manual orders carry explicit
  -- (FALSE-flag) device-local dates that the sync trigger must preserve, so
  -- without this the receipt would keep showing the original day.
  UPDATE public.orders
  SET transaction_date = p_transaction_date,
      invoice_issue_date = CASE
        WHEN transaction_date IS DISTINCT FROM p_transaction_date
        THEN (p_transaction_date AT TIME ZONE v_transaction_time_zone)::date
        ELSE invoice_issue_date
      END,
      tax_point_date = CASE
        WHEN transaction_date IS DISTINCT FROM p_transaction_date
        THEN (p_transaction_date AT TIME ZONE v_transaction_time_zone)::date
        ELSE tax_point_date
      END,
      invoice_issue_date_generated = CASE
        WHEN transaction_date IS DISTINCT FROM p_transaction_date
        THEN false
        ELSE invoice_issue_date_generated
      END,
      tax_point_date_generated = CASE
        WHEN transaction_date IS DISTINCT FROM p_transaction_date
        THEN false
        ELSE tax_point_date_generated
      END
  WHERE id = p_order_id
    AND merchant_id = p_merchant_id;

  GET DIAGNOSTICS v_order_rows = ROW_COUNT;

  IF v_order_rows = 0 THEN
    RAISE EXCEPTION 'Transaction not found for this merchant'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_update_product_default THEN
    IF p_variant_id IS NOT NULL THEN
      UPDATE public.product_variants AS v
      SET
        cost_price = p_cost_price,
        updated_at = now()
      FROM public.products AS p
      WHERE v.id = p_variant_id
        AND v.product_id = p_product_id
        AND v.merchant_id = p_merchant_id
        AND p.id = p_product_id
        AND p.merchant_id = p_merchant_id;
    ELSE
      UPDATE public.products
      SET
        cost_price = p_cost_price,
        metadata = CASE
          WHEN v_supplier_name = '' THEN
            COALESCE(metadata, '{}'::jsonb)
              - 'supplier_name'
              - 'supplier'
              - 'vendor_name'
              - 'vendor'
          ELSE
            (
              COALESCE(metadata, '{}'::jsonb)
                - 'supplier'
                - 'vendor'
            ) || jsonb_build_object(
              'supplier_name', v_supplier_name,
              'vendor_name', v_supplier_name
            )
        END,
        updated_at = now()
      WHERE id = p_product_id
        AND merchant_id = p_merchant_id;
    END IF;

    GET DIAGNOSTICS v_product_rows = ROW_COUNT;

    IF v_product_rows = 0 THEN
      RAISE EXCEPTION 'Product or variant not found for this merchant, or you do not have permission to update catalog defaults'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_transaction_review_details(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  numeric,
  text,
  timestamptz,
  text,
  boolean,
  integer,
  text,
  text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_transaction_review_details(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  numeric,
  text,
  timestamptz,
  text,
  boolean,
  integer,
  text,
  text
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

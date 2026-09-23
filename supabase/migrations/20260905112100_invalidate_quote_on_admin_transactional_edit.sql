-- After the transactional admin edit RPC changes quote inputs, clear the
-- saved quote/economics so booking cannot assert against a stale receiver or
-- item set. Skip when an active wallet charge or settled retention holds the
-- existing tariff.

CREATE OR REPLACE FUNCTION public.update_admin_order_with_transaction_discount_metadata(
  p_order_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_changed_fields text[] := ARRAY[]::text[];
  v_merchant_id uuid;
  v_ad_tracking jsonb;
  v_settled_retained numeric := 0;
BEGIN
  v_result := public.update_admin_order_with_transaction_discount_metadata_v1(
    p_order_id,
    p_payload
  );

  SELECT COALESCE(pg_catalog.array_agg(field), ARRAY[]::text[])
  INTO v_changed_fields
  FROM pg_catalog.jsonb_array_elements_text(
    COALESCE(v_result -> 'changed_fields', '[]'::jsonb)
  ) AS changed(field);

  v_merchant_id := NULLIF(v_result ->> 'merchant_id', '')::uuid;

  IF v_merchant_id IS NOT NULL
     AND v_changed_fields && ARRAY[
       'shipping_address',
       'items',
       'shipping_fee'
     ]::text[]
     AND NOT EXISTS (
       SELECT 1
       FROM public.merchant_shipping_charges AS charge
       WHERE charge.order_id = p_order_id
         AND charge.merchant_id = v_merchant_id
         AND charge.status IN (
           'reserved',
           'provider_submitting',
           'needs_reconciliation'
         )
     ) THEN
    v_settled_retained := private.order_settled_gigl_retained_amount(
      p_order_id,
      v_merchant_id
    );
    IF v_settled_retained <= 0 THEN
      UPDATE public.orders AS o
      SET
        selected_quote_id = NULL,
        shipping_provider_cost = NULL,
        shipping_platform_margin = NULL,
        shipping_platform_retained_amount = NULL,
        shipping_pricing_version = NULL,
        shipping_funding_source = CASE
          WHEN o.shipping_funding_source = 'merchant_wallet' THEN NULL
          ELSE o.shipping_funding_source
        END,
        updated_at = now()
      WHERE o.id = p_order_id
        AND o.merchant_id = v_merchant_id
        AND o.selected_quote_id IS NOT NULL;
    END IF;
  END IF;

  IF v_changed_fields && ARRAY['items', 'subtotal', 'discount_amount']::text[] THEN
    IF v_merchant_id IS NULL THEN
      RAISE EXCEPTION 'order_not_found';
    END IF;

    SELECT o.ad_tracking
    INTO v_ad_tracking
    FROM public.orders AS o
    WHERE o.id = p_order_id
      AND o.merchant_id = v_merchant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'order_not_found';
    END IF;

    INSERT INTO private.transaction_discount_admin_edit_context (
      transaction_id,
      order_id
    ) VALUES (
      pg_catalog.txid_current(),
      p_order_id
    )
    ON CONFLICT DO NOTHING;

    UPDATE public.orders AS o
    SET ad_tracking = pg_catalog.jsonb_set(
      CASE
        WHEN pg_catalog.jsonb_typeof(v_ad_tracking) = 'object'
          THEN v_ad_tracking
        ELSE '{}'::jsonb
      END,
      ARRAY['baci_transaction_discount'],
      jsonb_build_object('status', 'admin_edit', 'version', 4),
      true
    )
    WHERE o.id = p_order_id
      AND o.merchant_id = v_merchant_id;

    IF NOT FOUND THEN
      DELETE FROM private.transaction_discount_admin_edit_context
      WHERE transaction_id = pg_catalog.txid_current()
        AND order_id = p_order_id;
      RAISE EXCEPTION 'order_transaction_discount_provenance_failed';
    END IF;

    DELETE FROM private.transaction_discount_admin_edit_context
    WHERE transaction_id = pg_catalog.txid_current()
      AND order_id = p_order_id;
  END IF;

  RETURN v_result;
EXCEPTION WHEN others THEN
  DELETE FROM private.transaction_discount_admin_edit_context
  WHERE transaction_id = pg_catalog.txid_current()
    AND order_id = p_order_id;
  RAISE;
END;
$$;

ALTER FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  TO authenticated;

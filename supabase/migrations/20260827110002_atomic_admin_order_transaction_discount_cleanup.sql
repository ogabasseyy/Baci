-- Keep persisted negotiated discount allocations consistent with financial
-- order edits. The wrapper calls the existing edit RPC and removes the
-- server-authored transaction marker in the same transaction, so a cleanup
-- failure rolls back the financial edit instead of leaving stale allocations.
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
BEGIN
  v_result := public.update_admin_order(p_order_id, p_payload);

  SELECT COALESCE(pg_catalog.array_agg(field), ARRAY[]::text[])
  INTO v_changed_fields
  FROM pg_catalog.jsonb_array_elements_text(
    COALESCE(v_result -> 'changed_fields', '[]'::jsonb)
  ) AS changed(field);

  -- Shipping, gift-wrapping, and tax edits change the order total but do not
  -- change merchandise line boundaries or the negotiated discount itself.
  IF v_changed_fields && ARRAY['items', 'subtotal', 'discount_amount']::text[] THEN
    v_merchant_id := NULLIF(v_result ->> 'merchant_id', '')::uuid;

    SELECT o.ad_tracking
    INTO v_ad_tracking
    FROM public.orders AS o
    WHERE o.id = p_order_id
      AND o.merchant_id = v_merchant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'order_not_found';
    END IF;

    IF pg_catalog.jsonb_typeof(v_ad_tracking) = 'object'
      AND v_ad_tracking ? 'baci_transaction_discount'
    THEN
      UPDATE public.orders AS o
      SET ad_tracking = NULLIF(
        v_ad_tracking - 'baci_transaction_discount',
        '{}'::jsonb
      )
      WHERE o.id = p_order_id
        AND o.merchant_id = v_merchant_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'order_transaction_discount_cleanup_failed';
      END IF;
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  TO authenticated;

-- Force authenticated callers through the transaction-discount cleanup wrapper.
REVOKE ALL ON FUNCTION public.update_admin_order(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  IS 'Atomically applies an admin order edit and clears negotiated discount metadata when merchandise or discount fields change.';

-- Keep an explicit server-authored marker after an admin financial edit so
-- transaction review cannot mistake the edited discount for an old negotiation.
-- The prior cleanup function remains available only as an internal v1 helper;
-- this wrapper adds the provenance marker in the same transaction.
ALTER FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  RENAME TO update_admin_order_with_transaction_discount_metadata_v1;

REVOKE ALL ON FUNCTION public.update_admin_order_with_transaction_discount_metadata_v1(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

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
  v_result := public.update_admin_order_with_transaction_discount_metadata_v1(
    p_order_id,
    p_payload
  );

  SELECT COALESCE(pg_catalog.array_agg(field), ARRAY[]::text[])
  INTO v_changed_fields
  FROM pg_catalog.jsonb_array_elements_text(
    COALESCE(v_result -> 'changed_fields', '[]'::jsonb)
  ) AS changed(field);

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
      RAISE EXCEPTION 'order_transaction_discount_provenance_failed';
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

COMMENT ON FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  IS 'Atomically applies an admin order edit and records admin discount provenance when merchandise or discount fields change.';

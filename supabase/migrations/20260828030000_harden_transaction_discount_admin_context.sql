-- Bind the admin provenance marker to a private, transaction-local context.
-- A caller can set arbitrary custom GUCs, so the marker must not rely on a
-- client-writable setting to bypass the storefront metadata sanitizer.
CREATE TABLE IF NOT EXISTS private.transaction_discount_admin_edit_context (
  transaction_id bigint NOT NULL,
  order_id uuid NOT NULL,
  PRIMARY KEY (transaction_id, order_id)
);

ALTER TABLE private.transaction_discount_admin_edit_context ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.transaction_discount_admin_edit_context
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.transaction_discount_admin_edit_context IS
  'Private transaction context allowing only the admin edit wrapper to persist its provenance marker.';

CREATE OR REPLACE FUNCTION private.sanitize_storefront_transaction_discount_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tracking jsonb := NEW.ad_tracking;
  v_metadata jsonb;
  v_proof jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(v_tracking) <> 'object'
     OR NOT (v_tracking ? 'baci_transaction_discount') THEN
    RETURN NEW;
  END IF;

  v_metadata := v_tracking -> 'baci_transaction_discount';

  IF pg_catalog.jsonb_typeof(v_metadata) = 'object'
     AND v_metadata ->> 'status' = 'admin_edit'
     AND v_metadata ->> 'version' = '4'
     AND EXISTS (
       SELECT 1
       FROM private.transaction_discount_admin_edit_context AS context
       WHERE context.transaction_id = pg_catalog.txid_current()
         AND context.order_id = NEW.id
     ) THEN
    RETURN NEW;
  END IF;

  v_proof := CASE
    WHEN pg_catalog.jsonb_typeof(v_metadata) = 'object'
      THEN v_metadata -> 'proof'
    ELSE NULL
  END;

  IF pg_catalog.jsonb_typeof(v_metadata) = 'object'
     AND v_metadata ->> 'version' = '3'
     AND pg_catalog.jsonb_typeof(v_proof) = 'object'
     AND v_proof -> 'payload' = (v_metadata - 'proof')
     AND public.quiz_route_proof_valid(
       v_proof,
       'storefront_transaction_discount',
       NEW.merchant_id::text,
       NULL
     ) THEN
    RETURN NEW;
  END IF;

  NEW.ad_tracking := NULLIF(
    v_tracking - 'baci_transaction_discount',
    '{}'::jsonb
  );
  RETURN NEW;
END;
$$;

ALTER FUNCTION private.sanitize_storefront_transaction_discount_metadata()
  OWNER TO postgres;

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

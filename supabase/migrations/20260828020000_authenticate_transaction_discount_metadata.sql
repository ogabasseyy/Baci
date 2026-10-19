-- Only the order route may persist server-derived transaction discount
-- metadata. Public storefront RPC callers can still provide arbitrary
-- ad-tracking JSON, so strip the reserved marker unless its payload is bound
-- to a server HMAC proof. Admin edits use a transaction-local marker set by
-- the authenticated admin wrapper below.
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

  IF pg_catalog.current_setting('app.transaction_discount_admin_edit', true) = '1'
     AND pg_catalog.jsonb_typeof(v_metadata) = 'object'
     AND v_metadata ->> 'status' = 'admin_edit'
     AND v_metadata ->> 'version' = '4' THEN
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
REVOKE ALL ON FUNCTION private.sanitize_storefront_transaction_discount_metadata()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS sanitize_storefront_transaction_discount_metadata
  ON public.orders;
CREATE TRIGGER sanitize_storefront_transaction_discount_metadata
  BEFORE INSERT OR UPDATE OF ad_tracking, merchant_id
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.sanitize_storefront_transaction_discount_metadata();

-- Recreate the admin wrapper so its marker is accepted only for the one
-- update performed by this SECURITY DEFINER function, never for a caller's
-- direct create_storefront_order payload.
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
  PERFORM pg_catalog.set_config(
    'app.transaction_discount_admin_edit',
    '0',
    true
  );

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

    PERFORM pg_catalog.set_config(
      'app.transaction_discount_admin_edit',
      '1',
      true
    );
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
      PERFORM pg_catalog.set_config(
        'app.transaction_discount_admin_edit',
        '0',
        true
      );
      RAISE EXCEPTION 'order_transaction_discount_provenance_failed';
    END IF;
    PERFORM pg_catalog.set_config(
      'app.transaction_discount_admin_edit',
      '0',
      true
    );
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

COMMENT ON FUNCTION private.sanitize_storefront_transaction_discount_metadata()
  IS 'Keeps server-proven transaction discount metadata and strips forged public RPC payloads.';

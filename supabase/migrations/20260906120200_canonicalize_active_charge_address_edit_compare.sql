-- Canonicalize both sides of the active-charge address-edit trigger and keep
-- the admin-edit wrapper from rewriting a canonical address no-op into a
-- distinct JSON shape that the wrapped v1 / trigger would reject.

CREATE OR REPLACE FUNCTION private.block_active_shipping_charge_address_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_address jsonb;
  v_new_address jsonb;
BEGIN
  v_old_address := jsonb_strip_nulls(
    jsonb_build_object(
      'address', COALESCE(
        NULLIF(btrim(COALESCE(OLD.shipping_address, '{}'::jsonb) ->> 'address'), ''),
        ''
      ),
      'city', NULLIF(
        btrim(COALESCE(OLD.shipping_address, '{}'::jsonb) ->> 'city'),
        ''
      ),
      'name', NULLIF(
        btrim(COALESCE(OLD.shipping_address, '{}'::jsonb) ->> 'name'),
        ''
      ),
      'phone', COALESCE(
        NULLIF(btrim(COALESCE(OLD.shipping_address, '{}'::jsonb) ->> 'phone'), ''),
        ''
      ),
      'state', NULLIF(
        btrim(COALESCE(OLD.shipping_address, '{}'::jsonb) ->> 'state'),
        ''
      )
    )
  );
  v_new_address := jsonb_strip_nulls(
    jsonb_build_object(
      'address', COALESCE(
        NULLIF(btrim(COALESCE(NEW.shipping_address, '{}'::jsonb) ->> 'address'), ''),
        ''
      ),
      'city', NULLIF(
        btrim(COALESCE(NEW.shipping_address, '{}'::jsonb) ->> 'city'),
        ''
      ),
      'name', NULLIF(
        btrim(COALESCE(NEW.shipping_address, '{}'::jsonb) ->> 'name'),
        ''
      ),
      'phone', COALESCE(
        NULLIF(btrim(COALESCE(NEW.shipping_address, '{}'::jsonb) ->> 'phone'), ''),
        ''
      ),
      'state', NULLIF(
        btrim(COALESCE(NEW.shipping_address, '{}'::jsonb) ->> 'state'),
        ''
      )
    )
  );

  IF v_new_address IS NOT DISTINCT FROM v_old_address THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.order_id = OLD.id
      AND charge.status IN (
        'reserved',
        'provider_submitting',
        'needs_reconciliation'
      )
  ) THEN
    RAISE EXCEPTION 'active_shipping_charge_address_edit_blocked'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.block_active_shipping_charge_address_edit()
  FROM PUBLIC;


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
  v_order public.orders%ROWTYPE;
  v_existing_shipping_address jsonb := '{}'::jsonb;
  v_new_shipping_address jsonb := '{}'::jsonb;
  v_existing_items jsonb := '[]'::jsonb;
  v_new_items jsonb := '[]'::jsonb;
  v_payload_items jsonb := '[]'::jsonb;
  v_quote_inputs_would_change boolean := false;
BEGIN
  SELECT * INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.order_id = p_order_id
      AND charge.merchant_id = v_order.merchant_id
      AND charge.status IN (
        'reserved',
        'provider_submitting',
        'needs_reconciliation'
      )
  ) THEN
    IF jsonb_typeof(p_payload -> 'shipping_fee') = 'number'
       AND (p_payload ->> 'shipping_fee')::numeric IS DISTINCT FROM v_order.shipping_fee THEN
      v_quote_inputs_would_change := true;
    END IF;

    IF NOT v_quote_inputs_would_change
       AND jsonb_typeof(p_payload -> 'shipping_address') = 'object' THEN
      -- Normalize both sides the same way so empty-string locality keys in the
      -- stored address do not false-positive as quote-input changes.
      v_existing_shipping_address := jsonb_strip_nulls(
        jsonb_build_object(
          'address', COALESCE(
            NULLIF(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'address'), ''),
            ''
          ),
          'city', NULLIF(
            btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'city'),
            ''
          ),
          'name', NULLIF(
            btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'name'),
            ''
          ),
          'phone', COALESCE(
            NULLIF(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'phone'), ''),
            ''
          ),
          'state', NULLIF(
            btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'state'),
            ''
          )
        )
      );
      v_new_shipping_address := jsonb_strip_nulls(
        v_existing_shipping_address || jsonb_build_object(
          'address', COALESCE(
            NULLIF(btrim(p_payload #>> '{shipping_address,address}'), ''),
            ''
          ),
          'city', NULLIF(btrim(p_payload #>> '{shipping_address,city}'), ''),
          'name', NULLIF(btrim(p_payload #>> '{shipping_address,name}'), ''),
          'phone', COALESCE(
            NULLIF(btrim(p_payload #>> '{shipping_address,phone}'), ''),
            ''
          ),
          'state', NULLIF(btrim(p_payload #>> '{shipping_address,state}'), '')
        )
      );
      IF v_new_shipping_address IS DISTINCT FROM v_existing_shipping_address THEN
        v_quote_inputs_would_change := true;
      ELSE
        -- Canonical no-op: keep the stored address bytes so wrapped v1 and the
        -- address-edit trigger do not treat empty-key stripping as a change.
        p_payload := jsonb_set(
          p_payload,
          '{shipping_address}',
          COALESCE(v_order.shipping_address, '{}'::jsonb)
        );
      END IF;
    END IF;

    IF NOT v_quote_inputs_would_change THEN
      v_payload_items := COALESCE(p_payload -> 'items', '[]'::jsonb);
      IF jsonb_typeof(v_payload_items) <> 'array' THEN
        v_quote_inputs_would_change := true;
      ELSE
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'product_id', oi.product_id,
              'variant_id', oi.variant_id,
              'variant_name', NULLIF(btrim(oi.variant_name), ''),
              'name', btrim(oi.name),
              'quantity', oi.quantity,
              'price', oi.price,
              'condition', NULLIF(btrim(oi.condition), ''),
              'image_url', NULLIF(btrim(oi.image_url), ''),
              'item_description', NULLIF(btrim(oi.item_description), ''),
              'variant_attributes', CASE
                WHEN jsonb_typeof(COALESCE(oi.variant_attributes, '{}'::jsonb)) = 'object'
                  THEN COALESCE(oi.variant_attributes, '{}'::jsonb)
                ELSE '{}'::jsonb
              END,
              'product_match_status', COALESCE(
                NULLIF(btrim(oi.product_match_status), ''),
                CASE WHEN oi.product_id IS NULL THEN 'custom' ELSE 'linked' END
              )
            )
            ORDER BY oi.product_id,
              oi.variant_id,
              NULLIF(btrim(oi.variant_name), ''),
              btrim(oi.name),
              oi.price,
              oi.quantity,
              NULLIF(btrim(oi.condition), ''),
              NULLIF(btrim(oi.image_url), ''),
              NULLIF(btrim(oi.item_description), ''),
              CASE
                WHEN jsonb_typeof(COALESCE(oi.variant_attributes, '{}'::jsonb)) = 'object'
                  THEN COALESCE(oi.variant_attributes, '{}'::jsonb)::text
                ELSE '{}'::jsonb::text
              END,
              COALESCE(
                NULLIF(btrim(oi.product_match_status), ''),
                CASE WHEN oi.product_id IS NULL THEN 'custom' ELSE 'linked' END
              )
          ),
          '[]'::jsonb
        )
          INTO v_existing_items
        FROM public.order_items AS oi
        WHERE oi.order_id = p_order_id;

        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'product_id', NULLIF(item ->> 'product_id', '')::uuid,
              'variant_id', NULLIF(item ->> 'variant_id', '')::uuid,
              'variant_name', NULLIF(btrim(item ->> 'variant_name'), ''),
              'name', btrim(item ->> 'name'),
              'quantity', (item ->> 'quantity')::integer,
              'price', (item ->> 'price')::numeric,
              'condition', NULLIF(btrim(item ->> 'condition'), ''),
              'image_url', NULLIF(btrim(item ->> 'image_url'), ''),
              'item_description', NULLIF(btrim(item ->> 'item_description'), ''),
              'variant_attributes', CASE
                WHEN jsonb_typeof(item -> 'variant_attributes') = 'object'
                  THEN item -> 'variant_attributes'
                ELSE '{}'::jsonb
              END,
              'product_match_status', COALESCE(
                NULLIF(btrim(item ->> 'product_match_status'), ''),
                CASE
                  WHEN NULLIF(item ->> 'product_id', '') IS NULL THEN 'custom'
                  ELSE 'linked'
                END
              )
            )
            ORDER BY NULLIF(item ->> 'product_id', '')::uuid,
              NULLIF(item ->> 'variant_id', '')::uuid,
              NULLIF(btrim(item ->> 'variant_name'), ''),
              btrim(item ->> 'name'),
              (item ->> 'price')::numeric,
              (item ->> 'quantity')::integer,
              NULLIF(btrim(item ->> 'condition'), ''),
              NULLIF(btrim(item ->> 'image_url'), ''),
              NULLIF(btrim(item ->> 'item_description'), ''),
              CASE
                WHEN jsonb_typeof(item -> 'variant_attributes') = 'object'
                  THEN (item -> 'variant_attributes')::text
                ELSE '{}'::jsonb::text
              END,
              COALESCE(
                NULLIF(btrim(item ->> 'product_match_status'), ''),
                CASE
                  WHEN NULLIF(item ->> 'product_id', '') IS NULL THEN 'custom'
                  ELSE 'linked'
                END
              )
          ),
          '[]'::jsonb
        )
          INTO v_new_items
        FROM jsonb_array_elements(v_payload_items) AS item;

        IF v_new_items IS DISTINCT FROM v_existing_items THEN
          v_quote_inputs_would_change := true;
        END IF;
      END IF;
    END IF;

    IF v_quote_inputs_would_change THEN
      RAISE EXCEPTION 'active_shipping_charge_quote_input_edit_blocked'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

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

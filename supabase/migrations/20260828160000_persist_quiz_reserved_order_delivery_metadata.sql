-- Serialized quiz-prize orders are created before checkout and completed by
-- updating the reserved row. The insert-only storefront delivery trigger
-- therefore cannot persist or validate the delivery metadata supplied during
-- redemption. Keep this migration after the delivery trigger is live and
-- apply the same normalization on the reserved-order update path.

DO $$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    (
      'private.create_' ||
      'storefront_order_with_quiz_voucher(uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text, text, jsonb, text, text, jsonb, uuid, text, text, uuid, text, numeric, numeric, jsonb)'
    )::pg_catalog.regprocedure
  )
  INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION
      'The serialized quiz voucher function is required before delivery metadata can be persisted';
  END IF;

  v_updated := pg_catalog.regexp_replace(
    v_definition,
    'shipping_provider[[:space:]]*=[[:space:]]*COALESCE[[:space:]]*[(][[:space:]]*p_shipping_provider,[[:space:]]*shipping_provider[[:space:]]*[)],',
    'ad_tracking = COALESCE(p_ad_tracking, ad_tracking),' || pg_catalog.chr(10) ||
    '      shipping_provider = COALESCE(p_shipping_provider, shipping_provider),',
    1,
    1,
    'n'
  );

  IF v_updated = v_definition
    OR pg_catalog.strpos(v_updated, 'ad_tracking = COALESCE(p_ad_tracking, ad_tracking)') = 0 THEN
    RAISE EXCEPTION
      'The serialized quiz voucher function shape changed; refusing to patch its reserved-order metadata update';
  END IF;

  EXECUTE v_updated;
END;
$$;

-- Reset inherited nullable metadata before the shared trigger reads the
-- reserved ad_tracking context. Reserved rows predate these columns, but the
-- reset also prevents a stale value from winning over the current redemption.
CREATE OR REPLACE FUNCTION private.prepare_quiz_reserved_order_delivery_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.source = 'quiz_prize' AND OLD.payment_method = 'quiz_award' THEN
    NEW.delivery_method := NULL;
    NEW.airport_type := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prepare_quiz_reserved_order_delivery_metadata()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS prepare_quiz_reserved_order_delivery_metadata ON public.orders;

CREATE TRIGGER prepare_quiz_reserved_order_delivery_metadata
  BEFORE UPDATE OF shipping_fee, shipping_address, ad_tracking,
    shipping_provider, selected_quote_id ON public.orders
  FOR EACH ROW
  WHEN (OLD.source = 'quiz_prize' AND OLD.payment_method = 'quiz_award')
  EXECUTE FUNCTION private.prepare_quiz_reserved_order_delivery_metadata();

DROP TRIGGER IF EXISTS validate_quiz_reserved_order_delivery_metadata ON public.orders;

CREATE TRIGGER validate_quiz_reserved_order_delivery_metadata
  BEFORE UPDATE OF shipping_fee, shipping_address, ad_tracking,
    shipping_provider, selected_quote_id ON public.orders
  FOR EACH ROW
  WHEN (OLD.source = 'quiz_prize' AND OLD.payment_method = 'quiz_award')
  EXECUTE FUNCTION private.validate_storefront_order_delivery_metadata();

DROP TRIGGER IF EXISTS validate_quiz_reserved_order_airport_pickup_location ON public.orders;

CREATE TRIGGER validate_quiz_reserved_order_airport_pickup_location
  BEFORE UPDATE OF shipping_fee, shipping_address, ad_tracking,
    shipping_provider, selected_quote_id ON public.orders
  FOR EACH ROW
  WHEN (OLD.source = 'quiz_prize' AND OLD.payment_method = 'quiz_award')
  EXECUTE FUNCTION private.validate_storefront_airport_pickup_location();

COMMENT ON FUNCTION private.prepare_quiz_reserved_order_delivery_metadata() IS
  'Clears inherited delivery metadata before the shared storefront trigger normalizes redeemed serialized quiz orders.';

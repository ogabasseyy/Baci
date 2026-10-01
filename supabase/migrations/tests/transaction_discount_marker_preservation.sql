-- Attribution refreshes must not erase the historical discount marker when the
-- replacement object omits the server-authored key.
DO $$
DECLARE
  v_order_id uuid;
  v_tracking jsonb;
  v_expected_marker jsonb := jsonb_build_object(
    'version', 2,
    'lineDiscounts', jsonb_build_array(25)
  );
BEGIN
  SELECT order_id
  INTO v_order_id
  FROM public.order_items
  WHERE id = (SELECT ordinary_item_id FROM pg_temp.quiz_award_snapshot_fixture);

  ALTER TABLE public.orders
    DISABLE TRIGGER sanitize_storefront_transaction_discount_metadata;

  UPDATE public.orders
  SET ad_tracking = jsonb_build_object(
    'utm_source', 'original',
    'baci_transaction_discount', v_expected_marker
  )
  WHERE id = v_order_id;

  ALTER TABLE public.orders
    ENABLE TRIGGER sanitize_storefront_transaction_discount_metadata;

  UPDATE public.orders
  SET ad_tracking = jsonb_build_object('utm_source', 'refresh')
  WHERE id = v_order_id;

  SELECT ad_tracking
  INTO v_tracking
  FROM public.orders
  WHERE id = v_order_id;

  IF v_tracking ->> 'utm_source' IS DISTINCT FROM 'refresh'
     OR v_tracking -> 'baci_transaction_discount' IS DISTINCT FROM v_expected_marker
  THEN
    RAISE EXCEPTION
      'attribution refresh erased transaction discount marker: %',
      v_tracking;
  END IF;
END;
$$ LANGUAGE plpgsql;

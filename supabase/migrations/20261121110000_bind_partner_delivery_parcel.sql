-- Compare provider inputs independently of order-item storage order.
CREATE FUNCTION private.partner_delivery_parcel(p_items jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_agg(line ORDER BY line)
  FROM (
    SELECT jsonb_build_array(
      item->>'name', item->'quantity', item->'weight', item->'value',
      item->'length', item->'width', item->'height'
    ) AS line
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END
    ) AS item
  ) AS parcel;
$$;

REVOKE ALL ON FUNCTION private.partner_delivery_parcel(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.guard_partner_delivery_destination()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_paid_request jsonb;
  v_bound_request jsonb;
  v_paid_parcel jsonb;
BEGIN
  SELECT q.snapshot #> '{carrier_quote,quote_request}'
  INTO v_paid_request
  FROM private.accepted_partner_orders AS a
  JOIN private.partner_order_submissions AS s ON s.id = a.submission_id
  JOIN private.partner_delivery_quotes AS q ON q.id = s.quote_id
    AND q.merchant_id = s.merchant_id AND q.connection_id = s.connection_id
  WHERE a.order_id = OLD.id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.source IS DISTINCT FROM 'partner' THEN
    RAISE EXCEPTION 'partner_order_source_immutable' USING ERRCODE = 'P0001';
  END IF;

  IF v_paid_request->'receiver' IS NULL
     OR private.partner_delivery_destination(NEW.shipping_address)
       IS DISTINCT FROM private.partner_delivery_destination(v_paid_request->'receiver') THEN
    RAISE EXCEPTION 'partner_delivery_destination_changed' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.selected_quote_id IS NOT NULL THEN
    SELECT sq.quote_request INTO v_bound_request
    FROM public.shipping_quotes AS sq
    WHERE sq.id = NEW.selected_quote_id AND sq.merchant_id = NEW.merchant_id;

    IF v_bound_request->'receiver' IS NULL
       OR private.partner_delivery_destination(v_bound_request->'receiver')
         IS DISTINCT FROM private.partner_delivery_destination(v_paid_request->'receiver') THEN
      RAISE EXCEPTION 'partner_delivery_destination_changed' USING ERRCODE = 'P0001';
    END IF;

    v_paid_parcel := private.partner_delivery_parcel(v_paid_request->'items');
    IF nullif(btrim(v_paid_request #>> '{sender,address}'), '') IS NULL
       OR private.partner_delivery_destination(v_bound_request->'sender')
         IS DISTINCT FROM private.partner_delivery_destination(v_paid_request->'sender')
       OR v_paid_parcel IS NULL
       OR private.partner_delivery_parcel(v_bound_request->'items') IS DISTINCT FROM v_paid_parcel THEN
      RAISE EXCEPTION 'partner_delivery_origin_or_parcel_changed' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER preserve_partner_delivery_destination ON public.orders;
CREATE TRIGGER preserve_partner_delivery_destination
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (
    NEW.shipping_address IS DISTINCT FROM OLD.shipping_address
    OR NEW.selected_quote_id IS DISTINCT FROM OLD.selected_quote_id
    OR NEW.source IS DISTINCT FROM OLD.source
  )
  EXECUTE FUNCTION private.guard_partner_delivery_destination();

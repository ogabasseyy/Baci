-- The paid quote controls the physical destination. Leave recipient contact
-- fields editable and compare the canonical fields that Baci sends to GIG.
CREATE FUNCTION private.partner_delivery_destination(p_receiver jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_array(
    p_receiver->>'address', p_receiver->>'city', p_receiver->>'state',
    p_receiver->>'country', p_receiver->>'countryCode', p_receiver->>'postalCode',
    p_receiver->'latitude', p_receiver->'longitude'
  );
$$;

REVOKE ALL ON FUNCTION private.partner_delivery_destination(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.guard_partner_delivery_destination()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_paid_receiver jsonb;
  v_bound_receiver jsonb;
BEGIN
  SELECT q.snapshot #> '{carrier_quote,quote_request,receiver}'
  INTO v_paid_receiver
  FROM private.accepted_partner_orders AS a
  JOIN private.partner_order_submissions AS s ON s.id = a.submission_id
  JOIN private.partner_delivery_quotes AS q ON q.id = s.quote_id
    AND q.merchant_id = s.merchant_id AND q.connection_id = s.connection_id
  WHERE a.order_id = OLD.id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  IF v_paid_receiver IS NULL
     OR private.partner_delivery_destination(NEW.shipping_address)
       IS DISTINCT FROM private.partner_delivery_destination(v_paid_receiver) THEN
    RAISE EXCEPTION 'partner_delivery_destination_changed' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.selected_quote_id IS NOT NULL THEN
    SELECT sq.quote_request->'receiver' INTO v_bound_receiver
    FROM public.shipping_quotes AS sq
    WHERE sq.id = NEW.selected_quote_id AND sq.merchant_id = NEW.merchant_id;

    IF v_bound_receiver IS NULL
       OR private.partner_delivery_destination(v_bound_receiver)
         IS DISTINCT FROM private.partner_delivery_destination(v_paid_receiver) THEN
      RAISE EXCEPTION 'partner_delivery_destination_changed' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_partner_delivery_destination()
  FROM PUBLIC, anon, authenticated, service_role;

-- Check the final row after other order normalization. The existing binding
-- trigger still validates the quote attestation, wallet, amount and service.
CREATE TRIGGER preserve_partner_delivery_destination
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (
    NEW.shipping_address IS DISTINCT FROM OLD.shipping_address
    OR NEW.selected_quote_id IS DISTINCT FROM OLD.selected_quote_id
  )
  EXECUTE FUNCTION private.guard_partner_delivery_destination();

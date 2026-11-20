-- The normal admin GIG quote binder and merchant-wallet booking path remain the
-- writers. Check the final funding state after the existing economics trigger.
CREATE FUNCTION private.guard_partner_shipping_quote_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery_minor numeric;
  v_quote record;
BEGIN
  SELECT (q.snapshot->>'delivery_minor')::numeric INTO v_delivery_minor
  FROM private.accepted_partner_orders AS a
  JOIN private.partner_order_submissions AS s ON s.id = a.submission_id
  JOIN private.partner_delivery_quotes AS q ON q.id = s.quote_id
    AND q.merchant_id = s.merchant_id AND q.connection_id = s.connection_id
  WHERE a.order_id = NEW.id AND s.merchant_id = NEW.merchant_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.shipping_funding_source = 'customer_checkout'
     OR COALESCE(NEW.shipping_platform_retained_amount, 0) <> 0 THEN
    RAISE EXCEPTION 'partner_shipping_requires_merchant_wallet' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.selected_quote_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.shipping_funding_source IS DISTINCT FROM 'merchant_wallet'
     OR NEW.shipping_provider IS DISTINCT FROM 'GIGL' THEN
    RAISE EXCEPTION 'partner_shipping_requires_merchant_wallet' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.selected_quote_id IS NOT DISTINCT FROM OLD.selected_quote_id THEN
    RETURN NEW;
  END IF;

  SELECT sq.provider, sq.currency, sq.session_id, sq.expires_at, sq.used,
    sq.is_station_pickup, sq.price, sq.quote_request
  INTO v_quote
  FROM public.shipping_quotes AS sq
  JOIN public.shipping_quote_attestations AS a ON a.quote_id = sq.id
    AND a.merchant_id = sq.merchant_id AND a.order_id = NEW.id
    AND a.price = sq.price AND a.currency = sq.currency
    AND a.provider_rate_id IS NOT DISTINCT FROM sq.provider_rate_id
    AND a.quote_request IS NOT DISTINCT FROM sq.quote_request
    AND a.expires_at = sq.expires_at
  WHERE sq.id = NEW.selected_quote_id AND sq.merchant_id = NEW.merchant_id;
  IF NOT FOUND
     OR v_quote.provider IS DISTINCT FROM 'GIGL'
     OR v_quote.currency IS DISTINCT FROM 'NGN'
     OR v_quote.session_id IS DISTINCT FROM NEW.id::text
     OR v_quote.expires_at <= clock_timestamp()
     OR v_quote.used IS TRUE OR v_quote.is_station_pickup IS TRUE
     OR v_quote.quote_request->>'shipmentType' IS DISTINCT FROM 'domestic'
     OR v_quote.quote_request->>'admin_order_provenance' IS DISTINCT FROM 'server_gigl_v1' THEN
    RAISE EXCEPTION 'partner_shipping_quote_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_delivery_minor IS NULL OR v_delivery_minor <= 0
     OR v_quote.price <= 0 OR v_quote.price * 100 > v_delivery_minor THEN
    RAISE EXCEPTION 'partner_delivery_price_changed' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_partner_shipping_quote_binding()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER guard_partner_shipping_quote_binding
  AFTER UPDATE OF selected_quote_id, shipping_funding_source, shipping_provider,
    shipping_platform_retained_amount, payment_method, payment_status
  ON public.orders
  FOR EACH ROW
  WHEN (
    OLD.selected_quote_id IS DISTINCT FROM NEW.selected_quote_id
    OR OLD.shipping_funding_source IS DISTINCT FROM NEW.shipping_funding_source
    OR OLD.shipping_provider IS DISTINCT FROM NEW.shipping_provider
    OR OLD.shipping_platform_retained_amount IS DISTINCT FROM NEW.shipping_platform_retained_amount
  )
  EXECUTE FUNCTION private.guard_partner_shipping_quote_binding();

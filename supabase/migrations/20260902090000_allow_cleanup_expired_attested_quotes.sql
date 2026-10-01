-- Keep attested quotes immutable while allowing the TTL cleanup job to remove
-- quotes that can no longer be used and are not selected by an order.
CREATE OR REPLACE FUNCTION private.prevent_attested_quote_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND OLD.expires_at < now()
     AND OLD.used IS FALSE
     AND NOT EXISTS (
       SELECT 1
       FROM public.orders o
       WHERE o.selected_quote_id = OLD.id
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.merchant_shipping_charges c
       WHERE c.shipping_quote_id = OLD.id
     ) THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.shipping_quote_attestations a
    WHERE a.quote_id = COALESCE(NEW.id, OLD.id)
  ) THEN
    RAISE EXCEPTION 'attested_shipping_quote_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Skip still-referenced or otherwise active quotes so one attested quote does
-- not abort cleanup of every other expired quote in the same statement.
CREATE OR REPLACE FUNCTION public.cleanup_expired_shipping_quotes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  DELETE FROM shipping_quotes sq
  WHERE sq.expires_at < now()
    AND sq.used IS FALSE
    AND NOT EXISTS (
      SELECT 1
      FROM orders o
      WHERE o.selected_quote_id = sq.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM merchant_shipping_charges c
      WHERE c.shipping_quote_id = sq.id
    );
END;
$$;

ALTER FUNCTION public.cleanup_expired_shipping_quotes() OWNER TO postgres;

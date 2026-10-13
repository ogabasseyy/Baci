-- The reserved-order preparation trigger must clear inherited metadata only
-- during redemption. Later fulfillment updates can touch shipping fields after
-- the redemption trigger has stripped its reserved ad_tracking keys; clearing
-- the stored discriminator then would make an airport order look ordinary.

CREATE OR REPLACE FUNCTION private.prepare_quiz_reserved_order_delivery_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.source = 'quiz_prize'
     AND OLD.payment_method = 'quiz_award'
     AND pg_catalog.jsonb_typeof(NEW.ad_tracking) = 'object'
     AND (
       NEW.ad_tracking ? '__baci_delivery_method'
       OR NEW.ad_tracking ? '__baci_airport_type'
     )
  THEN
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

COMMENT ON FUNCTION private.prepare_quiz_reserved_order_delivery_metadata() IS
  'Clears inherited delivery metadata only while reserved serialized quiz orders carry redemption metadata.';

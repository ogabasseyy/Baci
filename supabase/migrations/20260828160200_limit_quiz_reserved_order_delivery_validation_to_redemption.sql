-- Reserved quiz-order delivery validation is required only during redemption.
-- Later fulfillment updates can touch shipping fields after redemption and
-- must retain the normalized metadata without revalidating an expired quote.

DROP TRIGGER IF EXISTS validate_quiz_reserved_order_delivery_metadata ON public.orders;

CREATE TRIGGER validate_quiz_reserved_order_delivery_metadata
BEFORE UPDATE OF shipping_fee, shipping_address, ad_tracking,
  shipping_provider, selected_quote_id ON public.orders
FOR EACH ROW
WHEN (
  OLD.source = 'quiz_prize'
  AND OLD.payment_method = 'quiz_award'
  AND pg_catalog.jsonb_typeof(NEW.ad_tracking) = 'object'
  AND (
    NEW.ad_tracking ? '__baci_delivery_method'
    OR NEW.ad_tracking ? '__baci_airport_type'
  )
)
EXECUTE FUNCTION private.validate_storefront_order_delivery_metadata();

DROP TRIGGER IF EXISTS validate_quiz_reserved_order_airport_pickup_location ON public.orders;

CREATE TRIGGER validate_quiz_reserved_order_airport_pickup_location
BEFORE UPDATE OF shipping_fee, shipping_address, ad_tracking,
  shipping_provider, selected_quote_id ON public.orders
FOR EACH ROW
WHEN (
  OLD.source = 'quiz_prize'
  AND OLD.payment_method = 'quiz_award'
  AND pg_catalog.jsonb_typeof(NEW.ad_tracking) = 'object'
  AND (
    NEW.ad_tracking ? '__baci_delivery_method'
    OR NEW.ad_tracking ? '__baci_airport_type'
  )
)
EXECUTE FUNCTION private.validate_storefront_airport_pickup_location();

COMMENT ON TRIGGER validate_quiz_reserved_order_delivery_metadata ON public.orders IS
  'Validates reserved quiz-order delivery metadata only while redemption carries the route-owned metadata keys.';

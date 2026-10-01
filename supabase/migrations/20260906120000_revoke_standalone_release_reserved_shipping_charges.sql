-- Standalone release_reserved_merchant_shipping_charges_for_order lets
-- authenticated staff refund reservations outside the atomic self-fulfill
-- transition. Self-fulfillment already inlines the refund; revoke client
-- execute so the helper cannot be invoked independently.

REVOKE ALL ON FUNCTION public.release_reserved_merchant_shipping_charges_for_order(uuid)
  FROM PUBLIC, anon, authenticated;

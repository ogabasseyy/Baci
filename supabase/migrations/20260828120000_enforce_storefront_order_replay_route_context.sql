-- Idempotent storefront-order retries update an existing row before they
-- return the replay result, so the INSERT route-context trigger cannot cover
-- that branch. Reuse the same context guard for the pending-order replay
-- update while leaving the independently authorized customer cancellation
-- transition to `cancelled` untouched.

DROP TRIGGER IF EXISTS enforce_storefront_order_replay_route_context
ON public.orders;

CREATE TRIGGER enforce_storefront_order_replay_route_context
BEFORE UPDATE ON public.orders
FOR EACH ROW
WHEN (
  OLD.checkout_idempotency_key IS NOT NULL
  AND NEW.checkout_idempotency_key IS NOT DISTINCT FROM OLD.checkout_idempotency_key
  AND NEW.shipping_status = 'pending'
)
EXECUTE FUNCTION private.enforce_storefront_order_route_context();

COMMENT ON TRIGGER enforce_storefront_order_replay_route_context ON public.orders IS
  'Requires the signed storefront route context (or an existing trusted internal context) before idempotent checkout replay updates.';

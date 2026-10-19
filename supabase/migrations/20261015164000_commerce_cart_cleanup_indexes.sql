-- Expiry indexes for the bounded retention cleanup in
-- 20261015163000_commerce_cart_cleanup_bounded: LIMIT bounds affected
-- rows, but without leading expires_at indexes every five-minute pass
-- would still scan each retained table in full once the backlog is
-- drained. Predicates match the cleanup statements exactly.
CREATE INDEX IF NOT EXISTS commerce_cart_account_operations_expires_idx
  ON public.commerce_cart_account_operations (expires_at);
CREATE INDEX IF NOT EXISTS commerce_cart_operations_expires_idx
  ON public.commerce_cart_operations (expires_at);
CREATE INDEX IF NOT EXISTS commerce_cart_creation_requests_expires_idx
  ON public.commerce_cart_creation_requests (expires_at);
CREATE INDEX IF NOT EXISTS commerce_cart_events_expires_idx
  ON public.commerce_cart_events (expires_at);
CREATE INDEX IF NOT EXISTS commerce_cart_handoffs_expires_idx
  ON public.commerce_cart_handoffs (expires_at);
CREATE INDEX IF NOT EXISTS commerce_cart_checkout_sessions_expires_idx
  ON public.commerce_cart_checkout_sessions (expires_at);
CREATE INDEX IF NOT EXISTS commerce_cart_checkout_sessions_submitted_idx
  ON public.commerce_cart_checkout_sessions (status, submitted_at);
CREATE INDEX IF NOT EXISTS commerce_carts_state_expires_idx
  ON public.commerce_carts (state, expires_at);

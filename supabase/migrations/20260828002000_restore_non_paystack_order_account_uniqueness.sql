-- Paystack order accounts intentionally retain expired history rows. Preserve
-- the original one-account-per-order/provider invariant for every provider
-- whose rows do not require that history.
CREATE UNIQUE INDEX IF NOT EXISTS unique_order_non_paystack_account
  ON public.order_payment_accounts (order_id, provider)
  WHERE provider <> 'paystack';

COMMENT ON INDEX public.unique_order_non_paystack_account
  IS 'Keeps non-Paystack order payment providers unique while Paystack aliases retain history.';

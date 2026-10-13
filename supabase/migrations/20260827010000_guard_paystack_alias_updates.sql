-- Apply the cross-flow Paystack alias guards to ownership-changing updates as
-- well as inserts. Invoice upserts use ON CONFLICT DO UPDATE when an order
-- already has an account row, so an account-number or order reassignment must
-- acquire the same serialized conflict checks as a fresh alias.

DROP TRIGGER IF EXISTS guard_order_paystack_dva_alias
  ON public.order_payment_accounts;
CREATE TRIGGER guard_order_paystack_dva_alias
  BEFORE INSERT OR UPDATE OF provider, account_number, order_id, assigned_at,
    expires_at
  ON public.order_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_paystack_dva_alias();

DROP TRIGGER IF EXISTS z_reject_cross_order_paystack_dva_alias
  ON public.order_payment_accounts;
CREATE TRIGGER z_reject_cross_order_paystack_dva_alias
  BEFORE INSERT OR UPDATE OF provider, account_number, order_id, assigned_at,
    expires_at
  ON public.order_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.reject_cross_order_paystack_dva_alias();

-- Allow authenticated merchant users to refresh DVA matching metadata while
-- preserving the same tenant boundary used by the existing insert policy.

DROP POLICY IF EXISTS owners_and_staff_update_order_payment_accounts
  ON public.order_payment_accounts;

CREATE POLICY owners_and_staff_update_order_payment_accounts
  ON public.order_payment_accounts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders AS orders
      WHERE orders.id = order_payment_accounts.order_id
        AND public.has_merchant_access(orders.merchant_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.orders AS orders
      WHERE orders.id = order_payment_accounts.order_id
        AND public.has_merchant_access(orders.merchant_id)
    )
  );

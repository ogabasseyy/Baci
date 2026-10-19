const PAYSTACK_DVA_PAYMENT_STATUSES = [
  'unpaid',
  'pending',
  'partially_paid',
] as const;

export function isEligibleOrderForPaystackDva(order: {
  cancelled_at?: string | null;
  payment_status?: string | null;
  shipping_status?: string | null;
}) {
  return (
    PAYSTACK_DVA_PAYMENT_STATUSES.includes(
      order.payment_status as (typeof PAYSTACK_DVA_PAYMENT_STATUSES)[number]
    ) &&
    order.shipping_status !== 'cancelled' &&
    order.shipping_status !== 'canceled' &&
    !order.cancelled_at
  );
}

export const PAYMENT_STATUSES = [
  'Paid',
  'Unpaid',
  'Pending',
  'Partially Paid',
  'Refunded',
  // Credit Direct funds BNPL orders, flipping payment_status to this
  // alongside paid; cancellations need the same refund recovery.
  'Bnpl Approved',
] as const;

export const SHIPPING_STATUSES = [
  'Pending',
  'Processing',
  'Shipped',
  'Delivered',
  'Canceled',
  'Returned',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type ShippingStatus = (typeof SHIPPING_STATUSES)[number];

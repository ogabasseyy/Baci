export const ORDER_BINDING_VARIANTS = [
  'base',
  'savings',
  'quiz_voucher',
  'discount_code',
] as const;

export type OrderBindingVariant = (typeof ORDER_BINDING_VARIANTS)[number];

/**
 * Order row mirrored from the inner RPC in snake_case so route and
 * dispatch continuations read it like a direct RPC row.
 * `idempotency_replayed` tracks the binding: a replayed binding never
 * created a new order.
 */
export interface BoundOrder {
  id: string;
  order_number: string;
  tracking_token: string | null;
  subtotal: number;
  shipping_fee: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
  customer_id: string | null;
  customer_email: string;
  customer_name: string;
  customer_phone: string | null;
  payment_status: string;
  shipping_status: string;
  payment_method: string;
  shipping_address: unknown;
  merchant_id: string;
  tax_basis: string;
  gift_wrapping_fee: number;
  idempotency_replayed: boolean;
  // Savings-variant inner columns. Present only on savings receipts;
  // the route requires them to report the redemption instead of 409.
  savings_redemption_success?: boolean;
  savings_redeemed_amount?: number | null;
  savings_goal_id?: string | null;
  savings_redemption_id?: string | null;
  savings_goal_status?: string | null;
}

export interface OrderBindingReceipt {
  sessionId: string;
  cartId: string;
  merchantId: string;
  checkoutGeneration: number;
  cartVersionReviewed: number;
  variant: OrderBindingVariant;
}

export type OrderBindingErrorCode =
  | 'refresh_required'
  | 'not_found'
  | 'expired'
  | 'unauthorized'
  | 'invalid_item'
  | 'order_rejected'
  | 'temporarily_unavailable';

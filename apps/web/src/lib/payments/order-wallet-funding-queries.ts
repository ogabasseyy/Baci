import type { SupabaseClient } from '@supabase/supabase-js';
import { toRichPaidOrder } from '@/lib/payments/paid-order-normalization';
import type { PaidOrderSideEffectTransaction } from '@/lib/payments/run-paid-order-side-effects';
import { paidOrderSideEffectTransactionSchema } from '@/schemas/paid-order-side-effects';

const RICH_ORDER_SELECT = [
  'id',
  'merchant_id',
  'order_number',
  'customer_id',
  'total',
  'subtotal',
  'shipping_fee',
  'shipping_provider',
  'shipping_funding_source',
  'shipping_platform_retained_amount',
  'gift_wrapping_fee',
  'tax_amount',
  'discount_amount',
  'tax_basis',
  'customer_name',
  'customer_email',
  'customer_phone',
  'shipping_address',
  'currency',
  'payment_status',
  'shipping_status',
  'updated_at',
  'ad_tracking',
  'order_items(id, product_id, condition, name, price, quantity, variant_name)',
].join(', ');
const ORDER_TRANSACTION_SELECT = [
  'id',
  'order_id',
  'merchant_id',
  'gateway_reference',
  'amount',
  'platform_fee',
].join(', ');
export const WALLET_ORDER_GATEWAY_PREFIX = 'WALLET-DVA-ORDER-';

function parsePaymentTransaction(
  data: unknown,
  context: string
): PaidOrderSideEffectTransaction {
  const parsed = paidOrderSideEffectTransactionSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Invalid wallet order payment transaction ${context}: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

export async function fetchPaidOrder({
  merchantId,
  orderId,
  supabase,
}: {
  merchantId: string;
  orderId: string;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase
    .from('orders')
    .select(RICH_ORDER_SELECT)
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .eq('payment_status', 'paid')
    .single();
  if (error) {
    throw error;
  }
  return toRichPaidOrder(data, { merchantId });
}

export async function fetchOrderPaymentTransaction({
  merchantId,
  transactionId,
  supabase,
}: {
  merchantId: string;
  transactionId: string;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase
    .from('transactions')
    .select(ORDER_TRANSACTION_SELECT)
    .eq('id', transactionId)
    .eq('merchant_id', merchantId)
    .single();
  if (error) {
    throw error;
  }
  return parsePaymentTransaction(data, 'by id');
}

export async function fetchOrderPaymentTransactionByOrder({
  merchantId,
  orderId,
  supabase,
}: {
  merchantId: string;
  orderId: string;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase
    .from('transactions')
    .select(ORDER_TRANSACTION_SELECT)
    .eq('order_id', orderId)
    .eq('gateway_reference', `${WALLET_ORDER_GATEWAY_PREFIX}${orderId}`)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data ? parsePaymentTransaction(data, 'by order') : null;
}

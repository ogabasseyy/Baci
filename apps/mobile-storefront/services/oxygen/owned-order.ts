import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { oxygenOrderPrefill } from './order-prefill';
import { isClosedOxygenShippingStatus } from './oxygen-order-status';

const orderSchema = z.object({
  id: z.uuid(),
  order_number: z.string().nullish(),
  total: z.coerce.number().positive(),
  amount_paid: z.coerce.number().finite().nonnegative().optional(),
  wallet_amount_used: z.coerce.number().finite().nonnegative().optional(),
  payment_method: z.string(),
  payment_status: z.string(),
  shipping_status: z.string(),
  customer_email: z.unknown().optional(),
  shipping_address: z.unknown().optional(),
  delivery_method: z.unknown().optional(),
});
function sumPositiveAmounts(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum: number, row) => {
    const raw =
      row && typeof row === 'object'
        ? (row as { amount?: unknown }).amount
        : undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
}

export async function readOwnedOxygenOrder(
  orderId: string,
  customerId: string,
  merchantId: string
) {
  z.uuid().parse(orderId);
  z.uuid().parse(customerId);
  z.uuid().parse(merchantId);
  const [
    { data, error },
    { data: walletLedgerRows, error: walletLedgerError },
    { data: savingsLedgerRows, error: savingsLedgerError },
  ] = await Promise.all([
    supabase
      .from('orders')
      .select(
        'id,order_number,total,amount_paid,wallet_amount_used,payment_method,payment_status,shipping_status,customer_email,shipping_address,delivery_method'
      )
      .eq('id', orderId)
      .eq('customer_id', customerId)
      .eq('merchant_id', merchantId)
      .single(),
    supabase
      .from('customer_wallet_transactions')
      .select('amount')
      .eq('source_id', orderId)
      .eq('customer_id', customerId)
      .eq('merchant_id', merchantId)
      .eq('source_type', 'order_redemption')
      .eq('type', 'redemption'),
    supabase
      .from('customer_savings_redemptions')
      .select('amount')
      .eq('order_id', orderId)
      .eq('customer_id', customerId)
      .eq('merchant_id', merchantId),
  ]);
  if (error || walletLedgerError || savingsLedgerError)
    throw new Error(
      'Your saved order is unavailable. Check your account and connection.'
    );
  const order = orderSchema.parse(data);
  if (order.payment_method !== 'oxygen')
    throw new Error(
      'This order uses another payment method. Open it from your order history.'
    );
  if (
    isClosedOxygenShippingStatus(order.shipping_status) ||
    // Funded orders can be read back for the standard confirmation screen.
    !['unpaid', 'paid', 'bnpl_approved'].includes(order.payment_status)
  )
    throw new Error(
      'This order is closed. Open your order history for details.'
    );
  const walletLedgerUsed = sumPositiveAmounts(walletLedgerRows);
  const savingsLedgerUsed = sumPositiveAmounts(savingsLedgerRows);
  const preGatewayPaid =
    order.payment_status === 'unpaid'
      ? Math.max(
          order.amount_paid ?? 0,
          (order.wallet_amount_used ?? 0) + savingsLedgerUsed,
          walletLedgerUsed + savingsLedgerUsed,
          0
        )
      : Math.min(
          Math.max(order.wallet_amount_used ?? 0, walletLedgerUsed, 0) +
            savingsLedgerUsed,
          order.total
        );
  const payableTotal = Math.max(
    Number((order.total - preGatewayPaid).toFixed(2)),
    0
  );
  if (order.payment_status === 'unpaid' && payableTotal <= 0) {
    throw new Error(
      'Choose another payment option for this zero-balance order.'
    );
  }
  return { ...order, total: payableTotal, prefill: oxygenOrderPrefill(order) };
}

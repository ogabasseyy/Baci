import {
  computeOrderNetPayable,
  isPreGatewayCreditStatus,
  sumActiveSavingsLedgerCredit,
  summarizeWalletLedgerCredit,
} from '@baci/shared/lib';
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
export class ZeroBalanceOxygenOrderError extends Error {
  readonly orderId: string;
  readonly orderNumber?: string;

  constructor(orderId: string, orderNumber?: string | null) {
    super('Choose another payment option for this zero-balance order.');
    this.name = 'ZeroBalanceOxygenOrderError';
    this.orderId = orderId;
    this.orderNumber = orderNumber ?? undefined;
  }
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
      .select('amount, status, source_type, type')
      .eq('source_id', orderId)
      .eq('customer_id', customerId)
      .eq('merchant_id', merchantId),
    supabase
      .from('customer_savings_redemptions')
      .select('amount, metadata')
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
    !['unpaid', 'pending', 'paid', 'bnpl_approved'].includes(
      order.payment_status
    )
  )
    throw new Error(
      'This order is closed. Open your order history for details.'
    );
  const walletSummary = summarizeWalletLedgerCredit(walletLedgerRows);
  const savingsLedgerUsed = sumActiveSavingsLedgerCredit(savingsLedgerRows);
  const isPreGateway = isPreGatewayCreditStatus(order.payment_status);
  const payableTotal = computeOrderNetPayable({
    total: order.total,
    amountPaid: order.amount_paid,
    walletAmountUsed: order.wallet_amount_used,
    walletLedgerUsed: walletSummary.netCredit,
    savingsLedgerUsed,
    paymentStatus: order.payment_status,
    walletReversalCompleted: walletSummary.hasCompletedReversal,
    walletReversedCredit: walletSummary.reversedCredit,
  });
  if (isPreGateway && payableTotal <= 0) {
    throw new ZeroBalanceOxygenOrderError(order.id, order.order_number);
  }
  const effectiveWalletCredit = walletSummary.hasCompletedReversal
    ? walletSummary.netCredit
    : Math.max(order.wallet_amount_used ?? 0, walletSummary.netCredit);
  const preGatewayCreditUsed =
    Math.max(effectiveWalletCredit, 0) + savingsLedgerUsed;
  const settledFinancedPrincipal =
    typeof order.amount_paid === 'number' && order.amount_paid > 0
      ? Math.max(
          Math.round((order.amount_paid - preGatewayCreditUsed) * 100) / 100,
          0
        )
      : payableTotal;
  return {
    ...order,
    // Settled orders have 0 remaining payable balance; preserve financedPrincipal separately.
    payableTotal: isPreGateway ? payableTotal : 0,
    financedPrincipal: isPreGateway ? payableTotal : settledFinancedPrincipal,
    prefill: oxygenOrderPrefill(order),
  };
}

import { formatCurrency as formatCurrencyForCode } from '@/lib/currency';
import type { StorefrontOrderData as OrderData } from './fetch-storefront-order';

// Terminal payment states can never become payable: a cancelled, failed,
// or otherwise dead order must not offer payer instructions or a live
// DVA, even when an outstanding balance remains on the row.
const TERMINAL_PAY_FOR_ME_STATUSES = new Set([
  'abandoned',
  'cancelled',
  'canceled',
  'declined',
  'expired',
  'failed',
  'reversed',
]);

function isTerminalPayForMeStatus(status?: string | null): boolean {
  return (
    !!status && TERMINAL_PAY_FOR_ME_STATUSES.has(status.trim().toLowerCase())
  );
}

export interface PayerHandoff {
  isPayForMeUnpaid: boolean;
  payerAmountText: string;
  payerDetailsText: string | null;
  payerName: string;
  payerOutstandingBalance: number;
  payerTransferAccount: NonNullable<OrderData['virtual_account']> | null;
}

/**
 * Pay for Me handoff contract: nothing is delivered to the payer
 * contact server-side, and the tracking token is a full-PII bearer —
 * sharing any link that carries it would disclose the requester's
 * email, phone, and shipping address to the payer. The handoff is
 * therefore copyable payment instructions (amount + transfer details)
 * with no token, no link, and no PII. The copy must never claim a
 * delivery happened.
 */
export function buildPayerHandoff({
  merchantCountry,
  order,
  payerNameParam,
  type,
}: {
  merchantCountry?: string | null;
  order: OrderData | null;
  payerNameParam: string | null;
  type: string | null;
}): PayerHandoff {
  const isPayForMe = type === 'payforme';
  const payerName = payerNameParam || 'Friend';
  // Authoritative outstanding balance: wallet/savings credit applied at
  // creation is persisted onto the row (recordPreGatewayRedemption), so
  // the payer is asked for the residual — the same amount the server
  // provisioned the DVA and email for — never the full total again. A
  // paid order suppresses the handoff entirely.
  const payerOutstandingBalance = order
    ? Math.max(order.total - (order.amount_paid || 0), 0)
    : 0;
  // A cancelled/failed/refunded order with an outstanding balance is not
  // payable: reopening its tokenized success URL must not display and
  // copy a live DVA for an order that cannot be fulfilled. A shipping
  // cancellation retires the order the same way even while the payment
  // row stays unpaid. Only an active (non-terminal, non-paid,
  // shippable) status keeps the handoff.
  const isShippingCancelled =
    order?.shipping_status?.trim().toLowerCase() === 'cancelled';
  // The ?type=payforme parameter is caller-controlled: an ordinary
  // invoice or bank-transfer order opened with it must not offer Pay
  // for Me instructions. Genuine Pay for Me orders keep their distinct
  // stored method (never collapsed to invoice), so require it.
  const isStoredPayForMeMethod =
    order?.payment_method?.trim().toLowerCase() === 'payforme';
  const isPayForMeUnpaid =
    isPayForMe &&
    isStoredPayForMeMethod &&
    order?.payment_status !== 'paid' &&
    order?.payment_status !== 'refunded' &&
    !isTerminalPayForMeStatus(order?.payment_status) &&
    !isShippingCancelled &&
    payerOutstandingBalance > 0;
  // Same DVA-compatibility rule as the order email: Paystack DVAs settle
  // in NGN only, so a foreign-currency quote never prints the naira
  // account beside a dollar amount.
  const payerDvaCompatible =
    !order?.currency || order.currency.trim().toUpperCase() === 'NGN';
  const payerTransferAccount =
    payerDvaCompatible &&
    order &&
    payerOutstandingBalance > 0 &&
    order.virtual_account?.account_number
      ? order.virtual_account
      : null;
  // The stamped historical currency wins over the merchant's current
  // payout currency: a USD order revisited after the merchant switches to
  // NGN must still ask the payer in dollars. Absent/invalid codes fall
  // back to the merchant-country config inside the formatter.
  const payerAmountText = order
    ? formatCurrencyForCode(
        payerOutstandingBalance,
        merchantCountry,
        undefined,
        order.currency
      )
    : '';
  const payerDetailsText =
    isPayForMeUnpaid && order
      ? [
          `Payment for order ${order.order_number}: ${payerAmountText}`,
          ...(payerTransferAccount
            ? [
                `Bank: ${payerTransferAccount.bank_name || 'See your order email'}`,
                `Account name: ${payerTransferAccount.account_name || 'See your order email'}`,
                `Account number: ${payerTransferAccount.account_number}`,
              ]
            : []),
        ].join('\n')
      : null;
  return {
    isPayForMeUnpaid,
    payerAmountText,
    payerDetailsText,
    payerName,
    payerOutstandingBalance,
    payerTransferAccount,
  };
}

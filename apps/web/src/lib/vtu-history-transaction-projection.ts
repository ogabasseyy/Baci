/**
 * Row projection for the customer VTU history response.
 *
 * Lives here (not in the history route) per the Boy Scout Rule: that
 * module is already beyond the 300-line budget. Pure mapping —
 * gateway/payment-status joins plus refund fields — so the route
 * stays a thin auth/query/schedule shell.
 */
import { projectHistoryRefundFields } from '@/lib/vtu-history-refund-projection';
import { extractMetadataField, isString } from '@/lib/vtu-voucher-backfill';

export type PaymentGateway = 'paystack' | 'korapay';

export function isPaymentGateway(value: unknown): value is PaymentGateway {
  return value === 'paystack' || value === 'korapay';
}

export function getPaymentStatusKey(
  gateway: string,
  reference: string
): string {
  return `${gateway}:${reference}`;
}

function parseHistoryNumber({
  field,
  invalidMessage,
  transactionId,
  value,
}: {
  field: string;
  invalidMessage: string;
  transactionId: unknown;
  value: unknown;
}) {
  const amount = Number(value);
  if (Number.isFinite(amount)) {
    return amount;
  }

  console.error(invalidMessage, {
    [field]: value,
    transactionId,
  });
  return 0;
}

export function parseHistoryAmount(value: unknown, transactionId: unknown) {
  return parseHistoryNumber({
    field: 'amount',
    invalidMessage: 'Invalid VTU transaction amount in history response:',
    transactionId,
    value,
  });
}

export function parseHistoryCashback(value: unknown, transactionId: unknown) {
  return parseHistoryNumber({
    field: 'customerCashback',
    invalidMessage: 'Invalid VTU customer cashback amount in history response:',
    transactionId,
    value,
  });
}

export interface HistoryTransactionRow {
  id: unknown;
  amount: unknown;
  customer_cashback?: unknown;
  metadata: unknown;
  status: unknown;
  transaction_id?: unknown;
  [key: string]: unknown;
}

export interface ProjectedHistoryTransaction {
  [key: string]: unknown;
  amount: number;
  customer_cashback: number | null;
  payment_gateway: PaymentGateway | null;
  payment_reference: string | null;
  payment_status: string | null;
  repeat_data_plan_code: string | null;
  voucher_pin: string | null;
  units: string | null;
  address: string | null;
  refund_pending: boolean;
  refunded_to_wallet: number | null;
}

export function projectHistoryTransaction({
  paymentStatusByReference,
  transaction,
  voucherPin,
}: {
  paymentStatusByReference: Map<string, string>;
  transaction: HistoryTransactionRow;
  voucherPin: string | null;
}): ProjectedHistoryTransaction {
  const {
    metadata: transactionMetadata,
    transaction_id: _transactionId,
    ...publicTransaction
  } = transaction;
  const dataPlanCode = extractMetadataField(
    transactionMetadata,
    'dataPlanCode',
    isString
  );
  // Delivered units (e.g. prepaid electricity kWh) and the meter/
  // customer address, surfaced so the receipt can render them.
  const units = extractMetadataField(transactionMetadata, 'units', isString);
  const address = extractMetadataField(
    transactionMetadata,
    'address',
    isString
  );
  const paymentGateway = extractMetadataField(
    transactionMetadata,
    'gateway',
    isPaymentGateway
  );
  const paymentReference = extractMetadataField(
    transactionMetadata,
    'paymentReference',
    isString
  );
  const { refund_pending, refunded_to_wallet } = projectHistoryRefundFields({
    metadata: transactionMetadata as Record<string, unknown> | null,
    status: transaction.status,
  });

  return {
    ...publicTransaction,
    amount: parseHistoryAmount(transaction.amount, transaction.id),
    customer_cashback:
      transaction.customer_cashback != null
        ? parseHistoryCashback(transaction.customer_cashback, transaction.id)
        : null,
    payment_gateway: paymentGateway,
    payment_reference: paymentReference,
    payment_status:
      paymentGateway && paymentReference
        ? (paymentStatusByReference.get(
            getPaymentStatusKey(paymentGateway, paymentReference)
          ) ?? null)
        : null,
    repeat_data_plan_code: dataPlanCode,
    voucher_pin: voucherPin,
    units,
    address,
    refund_pending,
    refunded_to_wallet,
  };
}

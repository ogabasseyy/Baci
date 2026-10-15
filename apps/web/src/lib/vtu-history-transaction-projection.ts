/**
 * Row projection for the customer VTU history response.
 *
 * Lives here (not in the history route) per the Boy Scout Rule: that
 * module is already beyond the 300-line budget. Pure mapping —
 * gateway/payment-status joins plus refund fields — so the route
 * stays a thin auth/query/schedule shell.
 */
import { projectHistoryRefundFields } from '@/lib/vtu-history-refund-projection';
import {
  extractMetadataField,
  isString,
  VTU_CUSTOMER_FAILURE_MESSAGE,
  VTU_CUSTOMER_SAFE_ERROR_MESSAGE_KEY,
} from '@/lib/vtu-metadata-fields';

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
  customer_id?: unknown;
  metadata: unknown;
  source?: unknown;
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
  refund_skipped: boolean;
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
    // Internal refund inputs: selected for the projection below, never
    // part of the customer-facing response contract.
    source: _source,
    customer_id: _customerId,
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
  // Provider error text is persisted raw in error_message for support
  // correlation but must never reach the customer (Codex R89 P1): it
  // returns verbatim only when the writer flagged it first-party,
  // else the fixed customer-safe message. Null/empty stays as-is so
  // successful rows keep a clean contract.
  const rawErrorMessage =
    typeof transaction.error_message === 'string' &&
    transaction.error_message.trim() !== ''
      ? transaction.error_message
      : null;
  const customerSafeErrorMessage =
    extractMetadataField(
      transactionMetadata,
      VTU_CUSTOMER_SAFE_ERROR_MESSAGE_KEY,
      (value): value is true => value === true
    ) === true;
  const { refund_pending, refund_skipped, refunded_to_wallet } =
    projectHistoryRefundFields({
    metadata: transactionMetadata as Record<string, unknown> | null,
    row: {
      amount: transaction.amount,
      customer_id: transaction.customer_id,
      id: transaction.id,
      source: transaction.source,
    },
    status: transaction.status,
  });

  return {
    ...publicTransaction,
    amount: parseHistoryAmount(transaction.amount, transaction.id),
    error_message:
      rawErrorMessage === null
        ? (transaction.error_message ?? null)
        : customerSafeErrorMessage
          ? rawErrorMessage
          : VTU_CUSTOMER_FAILURE_MESSAGE,
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
    refund_skipped,
    refunded_to_wallet,
  };
}

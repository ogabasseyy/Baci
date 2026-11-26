import {
  computeOrderNetPayable,
  sumActiveSavingsLedgerCredit,
  summarizeWalletLedgerCredit,
} from '@baci/shared/lib';
import type { SupabaseClient } from '@supabase/supabase-js';

function numberOrDefault(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export interface OrderSnapshotPaymentFields {
  total?: unknown;
  wallet_amount_used?: unknown;
  amount_paid?: unknown;
  payment_status?: unknown;
}

export type OrderPayableStateResult =
  | {
      ok: true;
      payableAmount: number;
      walletAmountUsed: number;
      savingsAmountUsed: number;
    }
  | {
      ok: false;
      message: string;
      code: string;
      status: number;
    };

/**
 * Computes net payable amount from the order's authoritative wallet and
 * device-savings ledger rows (or bounded RPC snapshot for REDVAULT guests).
 */
export async function readOrderPayableState(params: {
  paymentDataClient: SupabaseClient;
  orderId: string;
  merchantId: string;
  customerEmail: string;
  redvaultRequested: boolean;
  recheckSnapshot?: boolean;
  initialOrderSnapshot: OrderSnapshotPaymentFields;
  snapshotTotal: number;
}): Promise<OrderPayableStateResult> {
  const {
    paymentDataClient,
    orderId,
    merchantId,
    customerEmail,
    redvaultRequested,
    recheckSnapshot = false,
    initialOrderSnapshot,
    snapshotTotal,
  } = params;

  let total = snapshotTotal;
  let walletFromOrderRow = 0;
  let amountPaidFromOrderRow = 0;
  let orderPaymentStatus = 'unpaid';

  if (redvaultRequested) {
    let snapshot: OrderSnapshotPaymentFields = initialOrderSnapshot;
    if (recheckSnapshot) {
      const { data: snapshotRows, error: snapshotError } =
        await paymentDataClient.rpc('get_order_payment_snapshot', {
          p_order_id: orderId,
          p_email: customerEmail,
        });
      const freshSnapshot = Array.isArray(snapshotRows)
        ? (snapshotRows[0] as OrderSnapshotPaymentFields | undefined)
        : undefined;
      if (snapshotError || !freshSnapshot) {
        return {
          ok: false,
          message: 'Unable to verify order payment amount',
          code: 'ORDER_AMOUNT_LOOKUP_FAILED',
          status: 500,
        };
      }
      snapshot = freshSnapshot;
      const freshTotal = Number(freshSnapshot.total);
      if (
        freshSnapshot.total == null ||
        Number.isNaN(freshTotal) ||
        freshTotal <= 0
      ) {
        return {
          ok: false,
          message: 'Invalid order total',
          code: 'INVALID_ORDER_TOTAL',
          status: 400,
        };
      }
      total = freshTotal;
    }
    walletFromOrderRow = Math.max(
      numberOrDefault(snapshot.wallet_amount_used, 0),
      0
    );
    amountPaidFromOrderRow = Math.max(
      numberOrDefault(snapshot.amount_paid, 0),
      0
    );
    orderPaymentStatus =
      typeof snapshot.payment_status === 'string'
        ? snapshot.payment_status
        : 'unpaid';
  } else {
    const { data: orderPaymentRow, error: orderPaymentError } =
      await paymentDataClient
        .from('orders')
        .select('total, wallet_amount_used, amount_paid, payment_status')
        .eq('id', orderId)
        .eq('merchant_id', merchantId)
        .single();

    if (orderPaymentError || !orderPaymentRow) {
      return {
        ok: false,
        message: 'Unable to verify order payment amount',
        code: 'ORDER_AMOUNT_LOOKUP_FAILED',
        status: 500,
      };
    }

    if (recheckSnapshot) {
      const rawTotal = (orderPaymentRow as { total?: unknown }).total;
      const freshTotal = Number(rawTotal);
      if (rawTotal == null || !Number.isFinite(freshTotal) || freshTotal <= 0) {
        return {
          ok: false,
          message: 'Invalid order total',
          code: 'INVALID_ORDER_TOTAL',
          status: 400,
        };
      }
      total = freshTotal;
    }

    const typedOrderPaymentRow = orderPaymentRow as {
      wallet_amount_used?: unknown;
      amount_paid?: unknown;
      payment_status?: unknown;
    };
    amountPaidFromOrderRow = Math.max(
      numberOrDefault(typedOrderPaymentRow.amount_paid, 0),
      0
    );
    orderPaymentStatus =
      typeof typedOrderPaymentRow.payment_status === 'string'
        ? typedOrderPaymentRow.payment_status
        : 'unpaid';

    walletFromOrderRow = Math.max(
      numberOrDefault(typedOrderPaymentRow.wallet_amount_used, 0),
      0
    );
  }

  const normalizedOrderPaymentStatus = orderPaymentStatus.trim().toLowerCase();
  if (
    normalizedOrderPaymentStatus === 'paid' ||
    normalizedOrderPaymentStatus === 'bnpl_approved' ||
    normalizedOrderPaymentStatus === 'refunded' ||
    normalizedOrderPaymentStatus === 'cancelled' ||
    normalizedOrderPaymentStatus === 'canceled'
  ) {
    return {
      ok: false,
      message:
        'This order is already settled or closed and can no longer be paid',
      code: 'ORDER_NOT_PAYABLE',
      status: 409,
    };
  }

  const [
    { data: walletRows, error: walletError },
    { data: savingsRows, error: savingsError },
  ] = await Promise.all([
    paymentDataClient
      .from('customer_wallet_transactions')
      .select('amount, status, source_type, type')
      .eq('source_id', orderId)
      .eq('merchant_id', merchantId),
    paymentDataClient
      .from('customer_savings_redemptions')
      .select('amount, metadata')
      .eq('order_id', orderId)
      .eq('merchant_id', merchantId),
  ]);

  if (walletError) {
    return {
      ok: false,
      message: 'Unable to verify order wallet amount',
      code: 'ORDER_WALLET_LOOKUP_FAILED',
      status: 500,
    };
  }

  if (savingsError) {
    return {
      ok: false,
      message: 'Unable to verify order savings amount',
      code: 'ORDER_SAVINGS_LOOKUP_FAILED',
      status: 500,
    };
  }

  const walletSummary = summarizeWalletLedgerCredit(walletRows);
  const walletLedgerUsed = walletSummary.netCredit;
  const walletReversedCredit = walletSummary.reversedCredit;
  const hasWalletReversal = walletSummary.hasCompletedReversal;
  const walletAmountUsed = hasWalletReversal
    ? walletLedgerUsed
    : Math.max(walletFromOrderRow, walletLedgerUsed);
  const savingsAmountUsed = sumActiveSavingsLedgerCredit(savingsRows);
  const payableAmount = computeOrderNetPayable({
    total,
    amountPaid: amountPaidFromOrderRow,
    walletAmountUsed,
    walletLedgerUsed,
    walletReversedCredit,
    savingsLedgerUsed: savingsAmountUsed,
    paymentStatus: orderPaymentStatus,
    walletReversalCompleted: hasWalletReversal,
  });

  return {
    ok: true,
    payableAmount,
    walletAmountUsed,
    savingsAmountUsed,
  };
}

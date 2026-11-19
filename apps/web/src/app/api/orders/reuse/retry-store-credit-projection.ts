import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { recordPreGatewayRedemption } from '@/lib/payments/record-pre-gateway-redemption';

interface RetryOrderStoreCreditProjectionOptions {
  supabase: SupabaseClient;
  orderId: string;
  orderTotal: number;
}

export type RetryOrderStoreCreditProjectionResult =
  | { response: NextResponse }
  | { amountDueToGateway: number };

function sumNumericAmounts(
  rows: Array<{ amount?: unknown }> | null | undefined
): number {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, row) => {
    const amount = Number(row.amount);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0);
}

/**
 * Re-run store-credit projection on a reusable order whose wallet/savings debit
 * previously hit transient lock contention (`STORE_CREDIT_RETRY_REQUIRED`).
 * Reads only server-owned order and redemption rows under caller RLS.
 */
export async function retryOrderStoreCreditProjection({
  supabase,
  orderId,
  orderTotal,
}: RetryOrderStoreCreditProjectionOptions): Promise<RetryOrderStoreCreditProjectionResult> {
  if (!Number.isFinite(orderTotal) || orderTotal <= 0) {
    return {
      response: NextResponse.json(
        {
          error: 'Store credit requires payment review.',
          code: 'STORE_CREDIT_REVIEW_REQUIRED',
        },
        { status: 409 }
      ),
    };
  }

  const [walletResult, savingsResult] = await Promise.all([
    supabase
      .from('customer_wallet_transactions')
      .select('amount')
      .eq('source_id', orderId)
      .eq('source_type', 'order_redemption')
      .eq('type', 'redemption')
      .eq('status', 'completed'),
    supabase
      .from('customer_savings_redemptions')
      .select('amount, metadata')
      .eq('order_id', orderId),
  ]);

  if (walletResult.error || savingsResult.error) {
    return {
      response: NextResponse.json(
        {
          error: 'Store credit requires payment review.',
          code: 'STORE_CREDIT_REVIEW_REQUIRED',
        },
        { status: 409 }
      ),
    };
  }

  const walletAmountUsed = sumNumericAmounts(walletResult.data);
  const activeSavingsRows = (savingsResult.data ?? []).filter((row) => {
    const metadata = row.metadata as Record<string, unknown> | null;
    return metadata?.reversed_at == null;
  });
  const savingsAmountUsed = sumNumericAmounts(activeSavingsRows);

  if (walletAmountUsed + savingsAmountUsed <= 0) {
    return {
      response: NextResponse.json(
        {
          error: 'Store credit requires payment review.',
          code: 'STORE_CREDIT_REVIEW_REQUIRED',
        },
        { status: 409 }
      ),
    };
  }

  const projectionFailure = await recordPreGatewayRedemption(
    orderId,
    orderTotal,
    savingsAmountUsed,
    walletAmountUsed,
    supabase
  );
  if (projectionFailure) {
    return {
      response: NextResponse.json(
        {
          error: projectionFailure.message,
          code: projectionFailure.code,
        },
        { status: projectionFailure.status }
      ),
    };
  }

  return {
    amountDueToGateway: Math.max(
      0,
      orderTotal - walletAmountUsed - savingsAmountUsed
    ),
  };
}

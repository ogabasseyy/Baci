import type { SupabaseClient } from '@supabase/supabase-js';
import { hasSettledPaystackOrderPaymentReference } from '@/lib/payments/has-settled-paystack-order-payment-reference';
import { hasActivePaystackOrderDvaAlias } from '@/lib/payments/paystack-dva-order-alias';

const POSTGRES_UNIQUE_VIOLATION = '23505';

async function fileOrderAliasReview({
  accountNumber,
  gatewayReference,
  merchantId,
  paidAt,
  supabase,
  verifiedAmount,
}: {
  accountNumber: string;
  gatewayReference: string;
  merchantId: string;
  paidAt: Date;
  supabase: SupabaseClient;
  verifiedAmount: { amount: number; currency?: string };
}) {
  const { error } = await supabase.from('reconciliation_review').insert({
    candidates: [],
    issue_type: 'wallet_dva_order_alias_conflict',
    merchant_id: merchantId,
    metadata: {
      account_number: accountNumber,
      paid_at: paidAt.toISOString(),
      verified_amount: verifiedAmount.amount,
      verified_currency: verifiedAmount.currency ?? null,
    },
    paystack_ref: gatewayReference,
    reason:
      'Paystack receiver account belongs to a merchant wallet DVA but is still inside an active order DVA window.',
  });

  // A duplicate webhook means the original review was already filed. Treat
  // that unique violation as an idempotent success; any other write failure
  // must propagate so the webhook retries instead of acknowledging a payment
  // with no durable operator trail.
  if (
    error &&
    (error as { code?: string }).code !== POSTGRES_UNIQUE_VIOLATION
  ) {
    throw error;
  }
}

export type MerchantWalletDvaResult =
  | { kind: 'none' }
  | { kind: 'match'; balance: number; firstCredit: boolean }
  | {
      kind: 'review';
      status: 200 | 409;
      body: { code: string; error: string };
    };

export async function confirmPaystackMerchantWalletDva({
  supabase,
  accountNumber,
  gatewayReference,
  verifiedAmount,
  paystackResponse,
}: {
  supabase: SupabaseClient;
  accountNumber: string | null;
  gatewayReference: string;
  verifiedAmount: { amount: number; currency?: string } | null;
  paystackResponse: Record<string, unknown>;
}): Promise<MerchantWalletDvaResult> {
  if (
    !accountNumber ||
    !verifiedAmount ||
    verifiedAmount.amount <= 0 ||
    verifiedAmount.currency !== 'NGN'
  )
    return { kind: 'none' };
  const authorization = paystackResponse.authorization;
  const paystackChannel =
    authorization &&
    typeof authorization === 'object' &&
    'channel' in authorization
      ? String((authorization as { channel?: unknown }).channel ?? '').trim()
      : '';
  if (paystackChannel !== 'dedicated_nuban') return { kind: 'none' };
  const { data: accounts, error } = await supabase
    .from('merchant_wallet_payment_accounts')
    .select('merchant_id, account_number, status')
    .eq('account_number', accountNumber)
    .eq('status', 'active');
  if (error) throw error;
  if (accounts?.length !== 1)
    return accounts && accounts.length > 1
      ? {
          kind: 'review',
          status: 409,
          body: {
            code: 'MERCHANT_WALLET_DVA_AMBIGUOUS',
            error: 'Multiple merchant wallet accounts matched',
          },
        }
      : { kind: 'none' };
  const parsedPaidAt =
    typeof paystackResponse.paid_at === 'string'
      ? new Date(paystackResponse.paid_at)
      : null;
  const paidAt =
    parsedPaidAt && !Number.isNaN(parsedPaidAt.getTime())
      ? parsedPaidAt
      : new Date();
  if (
    await hasActivePaystackOrderDvaAlias({
      accountNumber,
      asOf: paidAt,
      supabase,
    })
  ) {
    await fileOrderAliasReview({
      accountNumber,
      gatewayReference,
      merchantId: accounts[0].merchant_id,
      paidAt,
      supabase,
      verifiedAmount,
    });
    // Durable review is enough for operators; acknowledge so Paystack stops
    // redelivering an immutable alias conflict that cannot settle as wallet credit.
    return {
      kind: 'review',
      status: 200,
      body: {
        code: 'WALLET_DVA_ORDER_ALIAS_CONFLICT',
        error:
          'Receiver account is reserved for an active order. Filed for manual reconciliation.',
      },
    };
  }
  if (
    await hasSettledPaystackOrderPaymentReference({
      gatewayReference,
      supabase,
    })
  ) {
    const { error: reviewError } = await supabase
      .from('reconciliation_review')
      .insert({
        candidates: [],
        issue_type: 'wallet_dva_order_payment_replay',
        merchant_id: accounts[0].merchant_id,
        metadata: {
          account_number: accountNumber,
          paid_at: paidAt.toISOString(),
          verified_amount: verifiedAmount.amount,
          verified_currency: verifiedAmount.currency ?? null,
        },
        paystack_ref: gatewayReference,
        reason:
          'Paystack reference already settled an order payment and cannot credit the merchant wallet.',
      });
    if (
      reviewError &&
      (reviewError as { code?: string }).code !== POSTGRES_UNIQUE_VIOLATION
    ) {
      throw reviewError;
    }
    // Durable review is enough for operators; acknowledge so Paystack stops
    // redelivering an immutable duplicate that can never settle as wallet credit.
    return {
      kind: 'review',
      status: 200,
      body: {
        code: 'WALLET_DVA_ORDER_PAYMENT_REPLAY',
        error:
          'Payment reference already settled an order. Filed for manual reconciliation.',
      },
    };
  }
  const { data, error: creditError } = await supabase.rpc(
    'credit_merchant_wallet_funding',
    {
      p_merchant_id: accounts[0].merchant_id,
      p_amount: verifiedAmount.amount,
      p_currency: 'NGN',
      p_reference: gatewayReference,
      p_account_number: accountNumber,
    }
  );
  if (creditError || !data?.[0])
    throw creditError ?? new Error('Merchant wallet funding credit failed');
  return {
    kind: 'match',
    balance: Number(data[0].new_balance),
    firstCredit: data[0].first_credit === true,
  };
}

// Matches a verified Paystack DVA payment to a persisted invoice account,
// reserves its transaction, or creates a manual-reconciliation result.

import type { SupabaseClient } from '@supabase/supabase-js';
import { findCustomerWalletPaymentAccountByReceiver } from '@/lib/customer-wallet-payment-accounts';
import { logger } from '@/lib/logger';
import { matchPaystackDvaCandidates } from '@/lib/payments/paystack-dva-multi-key-match';
import {
  getPaystackCustomerName,
  getPaystackDvaOrderCurrency,
  normalizePaystackDvaOrderCandidate,
  toPaystackKobo,
} from '@/lib/payments/paystack-dva-order-candidate';
import { calculatePlatformFee } from '@/lib/paystack';

const PAYSTACK_ACCOUNT_PATTERN = /^\d{6,20}$/;
const POSTGRES_UNIQUE_VIOLATION = '23505';
const TRANSACTION_SELECT =
  'id, amount, currency, merchant_id, metadata, order_id, platform_fee, gateway_reference';

type VerifiedAmount = { amount: number; currency?: string };

export type ConfirmPaystackDvaByOrderAccountTransaction = {
  id: string;
  amount: number | string | null;
  currency: string | null;
  merchant_id: string;
  metadata: Record<string, unknown> | null;
  order_id: string | null;
  platform_fee: number | null;
  gateway_reference: string | null;
};

// Discriminated by `kind` so callers can narrow:
//   - 'none'  → no match; caller falls through to gateway_reference lookup
//   - 'match' → pending txn inserted (or reused on 23505); caller flips it
//   - 'review' → ambiguous; caller returns the supplied status/body
export type ConfirmPaystackDvaByOrderAccountResult =
  | { kind: 'none' }
  | { kind: 'error'; status: number; body: Record<string, unknown> }
  | {
      kind: 'match';
      transaction: ConfirmPaystackDvaByOrderAccountTransaction;
    }
  | { kind: 'review'; status: number; body: Record<string, unknown> };

export async function confirmPaystackDvaByOrderAccount({
  supabase,
  accountNumber,
  gatewayReference,
  verifiedAmount,
  paystackResponse,
}: {
  supabase: SupabaseClient;
  accountNumber: string | null;
  gatewayReference: string;
  verifiedAmount: VerifiedAmount | null;
  paystackResponse: Record<string, unknown>;
}): Promise<ConfirmPaystackDvaByOrderAccountResult> {
  if (!accountNumber || !PAYSTACK_ACCOUNT_PATTERN.test(accountNumber)) {
    return { kind: 'none' };
  }
  if (!verifiedAmount || !Number.isFinite(verifiedAmount.amount)) {
    return { kind: 'none' };
  }
  const customer =
    paystackResponse?.customer && typeof paystackResponse.customer === 'object'
      ? (paystackResponse.customer as Record<string, unknown>)
      : null;
  const customerEmail =
    typeof customer?.email === 'string' ? customer.email : '';
  const paidAtRaw =
    typeof paystackResponse?.paid_at === 'string'
      ? paystackResponse.paid_at
      : null;
  const paidAt = paidAtRaw ? new Date(paidAtRaw) : null;
  if (!customerEmail || !paidAt || Number.isNaN(paidAt.getTime())) {
    return { kind: 'none' };
  }

  // Lookup by (provider, account_number) — multiple rows possible because
  // Paystack can reuse DVAs across a customer's sequential orders.
  // FK-join to orders gives us merchant_id + customer_email + total.
  const { data: rows, error: lookupError } = await supabase
    .from('order_payment_accounts')
    .select(
      'order_id, payable_amount, assignment_customer_email, assignment_customer_email_source, created_at, assigned_at, expires_at, orders!inner(id, merchant_id, customer_email, total, amount_paid, currency, payment_status, shipping_status, recorded_by_user_id)'
    )
    .eq('provider', 'paystack')
    .eq('account_number', accountNumber);

  if (lookupError) {
    logger.error({
      message: 'B1 order_payment_accounts lookup failed',
      accountNumber,
      error: lookupError.message,
    });
    return {
      body: { error: 'Paystack DVA matching temporarily unavailable' },
      kind: 'error',
      status: 500,
    };
  }
  if (!rows || rows.length === 0) {
    return { kind: 'none' };
  }

  const candidates = rows
    .map((row) =>
      normalizePaystackDvaOrderCandidate(row as Record<string, unknown>)
    )
    .filter((candidate) => candidate !== null);

  if (candidates.length === 0) {
    return { kind: 'none' };
  }

  const match = matchPaystackDvaCandidates(candidates, {
    verifiedAmountKobo: toPaystackKobo(verifiedAmount.amount),
    customerEmail,
    paidAt,
  });

  if (match.kind === 'none') {
    return { kind: 'none' };
  }

  // A reusable Paystack account may later become the customer's wallet DVA.
  // Once the order alias is outside its protected window, wallet ownership
  // wins so a top-up cannot be consumed by an expired invoice alias.
  if (match.timing === 'late' || match.allocation === 'partial') {
    try {
      const walletAccount = await findCustomerWalletPaymentAccountByReceiver({
        receiverAccountNumber: accountNumber,
        supabase,
      });
      if (walletAccount) {
        return { kind: 'none' };
      }
    } catch (error) {
      logger.error({
        message: 'B1 active wallet DVA lookup failed',
        accountNumber,
        error,
      });
      return {
        body: { error: 'Paystack DVA matching temporarily unavailable' },
        kind: 'error',
        status: 500,
      };
    }
  }

  if (match.kind === 'ambiguous') {
    // The partial unique index `(issue_type, paystack_ref) WHERE
    // resolved_at IS NULL AND paystack_ref IS NOT NULL` (per Δ-55)
    // means a retry of this code path raises Postgres `23505`. This
    // is the expected, benign no-op: the operator already has the
    // first-fired review row, the duplicate insert just confirms it.
    //
    // We log 23505 at `info` (it's normal Paystack webhook retry
    // traffic — Paystack re-fires on every non-2xx, and we return
    // 409 here on purpose). Anything else is a real failure to file
    // the review row and stays at `error`.
    const reviewRow = {
      issue_type: 'payment_match_ambiguous',
      paystack_ref: gatewayReference,
      reason: `${match.candidates.length} DVA candidates matched the ${match.allocation} allocation rules for account ${accountNumber}`,
      candidates: match.candidates.map((c) => ({
        order_id: c.order_id,
        merchant_id: c.merchant_id,
        customer_email: c.customer_email,
        total_kobo: c.total_kobo,
        payable_amount_kobo: c.payable_amount_kobo ?? null,
        outstanding_amount_kobo: c.outstanding_amount_kobo ?? null,
        merchant_created: c.merchant_created === true,
      })),
      metadata: {
        account_number: accountNumber,
        verified_amount: verifiedAmount.amount,
        customer_email: customerEmail,
        paid_at: paidAt.toISOString(),
      },
    };
    const { error: reviewErr } = await supabase
      .from('reconciliation_review')
      .insert(reviewRow);
    if (reviewErr) {
      const isDuplicate =
        (reviewErr as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION;
      if (isDuplicate) {
        logger.info({
          message:
            'B1 ambiguous DVA match — reconciliation_review already filed (expected webhook retry no-op)',
          accountNumber,
          paystackReference: gatewayReference,
        });
      } else {
        logger.error({
          message:
            'B1 ambiguous DVA match — failed to file reconciliation_review',
          accountNumber,
          paystackReference: gatewayReference,
          error: reviewErr,
        });
      }
    }
    return {
      kind: 'review',
      status: 409,
      body: {
        error:
          'Multiple orders match this DVA payment. Filed for manual reconciliation.',
        code: 'AMBIGUOUS_DVA_MATCH',
      },
    };
  }

  // Single match → reserve a pending transaction inside the locked RPC.
  const winner = match.candidate;
  const currency = getPaystackDvaOrderCurrency(rows, winner.order_id) ?? 'NGN';
  const requiresPartialInvoiceBalanceCheck = winner.merchant_created === true;
  const reservationFees = calculatePlatformFee(
    Math.round(verifiedAmount.amount * 100)
  );

  const { data: transactionId, error: reserveError } = await supabase.rpc(
    'create_payment_transaction',
    {
      p_amount: verifiedAmount.amount,
      p_currency: currency,
      p_customer_email: customerEmail,
      p_customer_name: getPaystackCustomerName(customer) ?? customerEmail,
      p_gateway: 'paystack',
      p_merchant_amount: reservationFees.merchantAmount / 100,
      p_merchant_id: winner.merchant_id,
      p_metadata: {
        dva_account_number: accountNumber,
        dva_lookup_path: 'order_payment_accounts',
        ...(requiresPartialInvoiceBalanceCheck && {
          order_payment_allocation: 'merchant_invoice_partial',
          order_payment_outstanding_before:
            (winner.outstanding_amount_kobo ?? winner.total_kobo) / 100,
        }),
      },
      p_order_id: winner.order_id,
      p_platform_fee: reservationFees.platformFee / 100,
      p_reference: gatewayReference,
      p_session_id: null,
    }
  );

  if (reserveError || !transactionId) {
    logger.error({
      message: 'B1 single-match transaction reservation failed',
      accountNumber,
      paystackReference: gatewayReference,
      error: reserveError,
    });
    return {
      body: { error: 'Paystack DVA matching temporarily unavailable' },
      kind: 'error',
      status: 500,
    };
  }

  const { data: inserted, error: transactionLookupError } = await supabase
    .from('transactions')
    .select(TRANSACTION_SELECT)
    .eq('id', transactionId)
    .eq('merchant_id', winner.merchant_id)
    .maybeSingle();

  if (transactionLookupError || !inserted) {
    logger.error({
      message: 'B1 single-match transaction reservation lookup failed',
      accountNumber,
      paystackReference: gatewayReference,
      transactionId,
      error: transactionLookupError,
    });
    return {
      body: { error: 'Paystack DVA matching temporarily unavailable' },
      kind: 'error',
      status: 500,
    };
  }
  return {
    kind: 'match',
    transaction: inserted as ConfirmPaystackDvaByOrderAccountTransaction,
  };
}

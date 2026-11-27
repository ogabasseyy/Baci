import type { PostgrestSingleResponse } from '@supabase/supabase-js';
import { after, type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  creditWalletTopUp,
  WALLET_TOP_UP_TRANSACTION_TYPE,
} from '@/lib/customer-wallet-top-up';
import { verifyPayment as verifyKorapayPayment } from '@/lib/korapay';
import { readPaystackWalletTopUpAmount } from '@/lib/payments/paystack-wallet-top-up-amount';
import { scheduleWalletTopUpCreditNotification } from '@/lib/payments/schedule-wallet-top-up-credit-notification';
import { verifyTransaction as verifyPaystackTransaction } from '@/lib/paystack';
import { resolveWalletTopUpMerchant } from '@/lib/resolve-wallet-top-up-merchant';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveVtuCustomer } from '@/lib/vtu-pending-transaction';
import { walletTopUpConfirmSchema } from '@/schemas/wallet-top-up';

function getVerifiedAmount(
  gateway: 'paystack' | 'korapay',
  payload: Record<string, unknown>
) {
  // A customer-paid Paystack fee is charged on top of the top-up; only the
  // principal is compared and credited.
  if (gateway === 'paystack') return readPaystackWalletTopUpAmount(payload);

  const rawAmount = payload.amount;
  if (typeof rawAmount !== 'number' || !Number.isFinite(rawAmount)) {
    return null;
  }

  return rawAmount;
}

function getVerifiedCurrency(payload: Record<string, unknown>) {
  return typeof payload.currency === 'string' ? payload.currency : null;
}

function isWalletTopUpGateway(value: unknown): value is 'paystack' | 'korapay' {
  return value === 'paystack' || value === 'korapay';
}

/** Currency for the credit push; `undefined` falls back to the wallet default. */
function transactionCurrencyOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// Merchant resolution uses id-first, slug-fallback via
// resolveWalletTopUpMerchant so a stale merchantId does not 404 when a
// valid merchantSlug is also supplied.

const TERMINAL_PAYMENT_STATUSES = new Set([
  'abandoned',
  'cancelled',
  'canceled',
  'declined',
  'expired',
  'failed',
  'reversed',
]);

function isTerminalPaymentStatus(status: string) {
  return TERMINAL_PAYMENT_STATUSES.has(status.trim().toLowerCase());
}

function isClientVerificationError(code?: string) {
  return (
    code === 'VALIDATION_ERROR' ||
    code === 'INVALID_REFERENCE' ||
    code === 'NOT_FOUND' ||
    code === 'HTTP_404'
  );
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const body = await request.json();
    const parsed = walletTopUpConfirmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Service role is intentionally scoped to backend-only wallet top-up
    // writes: customer identity is authenticated above, while transaction
    // claiming and wallet credit RPCs are not exposed through customer RLS.
    const supabase = createAdminClient();
    const merchant = await resolveWalletTopUpMerchant<{ id: string }>(
      supabase,
      parsed.data,
      'id'
    );

    if (!merchant) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const customer = await resolveVtuCustomer({
      supabase,
      merchantId: merchant.id,
      user: auth.user,
    });

    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    const { data: transaction, error: transactionError } = await supabase
      .from('transactions')
      .select('id, amount, currency, gateway, status, metadata, merchant_id')
      .eq('gateway_reference', parsed.data.reference)
      .eq('merchant_id', merchant.id)
      .maybeSingle();

    if (transactionError || !transaction) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    if (!isWalletTopUpGateway(transaction.gateway)) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    const metadata = (transaction.metadata ?? {}) as Record<string, unknown>;
    if (metadata.transaction_type !== WALLET_TOP_UP_TRANSACTION_TYPE) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    if (metadata.customer_id !== customer.id) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    if (transaction.status === 'completed') {
      console.info('Transaction already completed, retrying wallet credit', {
        reference: parsed.data.reference,
        transactionId: transaction.id,
      });
      const walletCredit = await creditWalletTopUp({
        amount: Number(transaction.amount),
        customerId: customer.id,
        gateway: transaction.gateway,
        merchantId: merchant.id,
        reference: parsed.data.reference,
        supabase,
        transactionId: transaction.id,
      });

      // This branch is a retry of an already-completed transaction, but the
      // wallet credit itself may still be outstanding (webhook marked the
      // transaction completed, credit failed/never ran). If THIS call is the
      // one that lands the credit, it is the caller that must notify.
      scheduleWalletTopUpCreditNotification({
        amount: Number(transaction.amount),
        currency: transactionCurrencyOf(transaction.currency),
        customerId: customer.id,
        firstCredit: walletCredit.firstCredit,
        merchantId: merchant.id,
        metadata,
        reference: parsed.data.reference,
        scheduleAfter: after,
        transactionId: transaction.id,
      });

      return NextResponse.json({
        amount: Number(transaction.amount),
        reference: walletCredit.reference,
        status: 'successful',
        success: true,
        wallet: {
          balance: walletCredit.balance,
        },
      });
    }

    let verification:
      | { success: true; data: Record<string, unknown> }
      | { success: false; code?: string; error: string };

    if (transaction.gateway === 'paystack') {
      const result = await verifyPaystackTransaction(parsed.data.reference);
      verification = result.success
        ? {
            data: result.data as unknown as Record<string, unknown>,
            success: true,
          }
        : { code: result.code, error: result.error, success: false };
    } else {
      const result = await verifyKorapayPayment(parsed.data.reference);
      verification = result.success
        ? {
            data: result.data as unknown as Record<string, unknown>,
            success: true,
          }
        : { code: result.code, error: result.error, success: false };
    }

    if (!verification.success) {
      if (isClientVerificationError(verification.code)) {
        return NextResponse.json(
          { error: verification.error },
          { status: 400 }
        );
      }

      console.error('Wallet top-up payment verification failed', {
        code: verification.code,
        error: verification.error,
        gateway: transaction.gateway,
        reference: parsed.data.reference,
      });
      return NextResponse.json(
        { error: 'Payment verification failed' },
        { status: 500 }
      );
    }

    const verifiedAmount = getVerifiedAmount(
      transaction.gateway,
      verification.data
    );
    if (verifiedAmount === null) {
      return NextResponse.json(
        { error: 'Unable to verify payment amount' },
        { status: 400 }
      );
    }

    const verifiedCurrency = getVerifiedCurrency(verification.data);
    const transactionCurrency =
      typeof transaction.currency === 'string' ? transaction.currency : null;
    if (
      !verifiedCurrency ||
      !transactionCurrency ||
      verifiedCurrency.toUpperCase() !== transactionCurrency.toUpperCase()
    ) {
      return NextResponse.json(
        { error: 'Payment currency mismatch' },
        { status: 400 }
      );
    }

    if (Math.abs(verifiedAmount - Number(transaction.amount)) > 0.01) {
      return NextResponse.json(
        { error: 'Payment amount mismatch' },
        { status: 400 }
      );
    }

    const paymentStatus =
      typeof verification.data.status === 'string'
        ? verification.data.status
        : '';
    if (paymentStatus !== 'success') {
      if (isTerminalPaymentStatus(paymentStatus)) {
        return NextResponse.json(
          {
            error: 'Payment was not successful',
            status: paymentStatus,
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: 'Payment is not yet successful', status: paymentStatus },
        { status: 409 }
      );
    }

    const { data: claimedTransaction, error: claimError } = (await supabase
      .from('transactions')
      .update({
        gateway_response: verification.data,
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', transaction.id)
      .neq('status', 'completed')
      .select('id')
      .maybeSingle()) as PostgrestSingleResponse<{ id: string } | null>;

    if (claimError) {
      console.error('Failed to claim transaction for wallet top-up confirm', {
        error: claimError.message,
        transactionId: transaction.id,
      });
      return NextResponse.json(
        { error: 'Failed to process wallet top-up' },
        { status: 500 }
      );
    }

    if (!claimedTransaction?.id) {
      console.info('Transaction already completed, retrying wallet credit', {
        reference: parsed.data.reference,
        transactionId: transaction.id,
      });
    }

    const walletCredit = await creditWalletTopUp({
      amount: Number(transaction.amount),
      customerId: customer.id,
      gateway: transaction.gateway,
      merchantId: merchant.id,
      reference: parsed.data.reference,
      supabase,
      transactionId: transaction.id,
    });

    // The card top-up path normally reaches THIS route (via
    // `waitForWalletTopUpConfirmation`) before the gateway webhook lands. The
    // credit is idempotent, so gating on `firstCredit` means the caller that
    // actually credited the wallet is the one that notifies — and the loser of
    // the race (`firstCredit: false`) stays silent. Scheduled through `after`,
    // so it cannot delay or change this response.
    scheduleWalletTopUpCreditNotification({
      amount: Number(transaction.amount),
      currency: transactionCurrencyOf(transaction.currency),
      customerId: customer.id,
      firstCredit: walletCredit.firstCredit,
      merchantId: merchant.id,
      metadata,
      reference: parsed.data.reference,
      scheduleAfter: after,
      transactionId: transaction.id,
    });

    return NextResponse.json({
      amount: Number(transaction.amount),
      reference: walletCredit.reference,
      status: 'successful',
      success: true,
      wallet: {
        balance: walletCredit.balance,
      },
    });
  } catch (error) {
    console.error('Failed to confirm wallet top-up', error);
    return NextResponse.json(
      { error: 'Failed to confirm wallet top-up' },
      { status: 500 }
    );
  }
}

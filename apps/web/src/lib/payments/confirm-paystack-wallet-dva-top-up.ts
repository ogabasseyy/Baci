import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AGENTIC_PAYSTACK_DVA_TRANSACTION_SELECT,
  type AgenticPaystackDvaTransaction,
  normalizeAgenticPaystackDvaTransaction,
} from '@/lib/agentic/paystack-dva-transaction';
import { findCustomerWalletPaymentAccountByReceiver } from '@/lib/customer-wallet-payment-accounts';
import { WALLET_TOP_UP_TRANSACTION_TYPE } from '@/lib/customer-wallet-top-up';
import { logger } from '@/lib/logger';
import { hasActivePaystackOrderDvaAlias } from '@/lib/payments/paystack-dva-order-alias';

const POSTGRES_UNIQUE_VIOLATION = '23505';

export type ConfirmPaystackWalletDvaTopUpResult =
  | { kind: 'match'; transaction: AgenticPaystackDvaTransaction }
  | { kind: 'none' }
  | {
      body: { code: 'WALLET_DVA_ORDER_ALIAS_CONFLICT'; error: string };
      kind: 'review';
      status: 200 | 409;
    };

function getCustomerEmail(paystackResponse: Record<string, unknown>) {
  const customer = paystackResponse.customer;
  if (!customer || typeof customer !== 'object') {
    return null;
  }

  const email = (customer as { email?: unknown }).email;
  return typeof email === 'string' && email.trim() ? email.trim() : null;
}

function getPaidAt(
  paystackResponse: Record<string, unknown>,
  gatewayReference: string
) {
  const paidAtRaw = paystackResponse.paid_at;
  const paidAt = typeof paidAtRaw === 'string' ? new Date(paidAtRaw) : null;
  if (paidAt && !Number.isNaN(paidAt.getTime())) {
    return paidAt;
  }

  logger.warn({
    message: 'Paystack wallet DVA top-up response missing valid paid_at',
    gatewayReference,
    paidAt: paidAtRaw,
  });
  return new Date();
}

async function fileOrderAliasReview({
  accountNumber,
  gatewayReference,
  paidAt,
  supabase,
  verifiedAmount,
}: {
  accountNumber: string;
  gatewayReference: string;
  paidAt: Date;
  supabase: SupabaseClient;
  verifiedAmount: { amount: number; currency?: string } | null;
}) {
  const { error } = await supabase.from('reconciliation_review').insert({
    candidates: [],
    issue_type: 'wallet_dva_order_alias_conflict',
    metadata: {
      account_number: accountNumber,
      paid_at: paidAt.toISOString(),
      verified_amount: verifiedAmount?.amount ?? null,
      verified_currency: verifiedAmount?.currency ?? null,
    },
    paystack_ref: gatewayReference,
    reason:
      'Paystack receiver account belongs to a wallet DVA but is still inside an active order DVA window.',
  });

  if (
    error &&
    (error as { code?: string }).code !== POSTGRES_UNIQUE_VIOLATION
  ) {
    logger.error({
      message: 'Failed to file wallet DVA order alias review',
      accountNumber,
      error,
      gatewayReference,
    });
  }
}

async function readWalletDvaTransaction({
  transactionId,
  supabase,
}: {
  transactionId: string;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase
    .from('transactions')
    .select(AGENTIC_PAYSTACK_DVA_TRANSACTION_SELECT)
    .eq('id', transactionId)
    .single();

  if (error || !data) {
    throw error ?? new Error('Wallet DVA transaction not found after conflict');
  }

  return normalizeAgenticPaystackDvaTransaction(data);
}

export async function confirmPaystackWalletDvaTopUp({
  accountNumber,
  gatewayReference,
  paystackResponse,
  supabase,
  verifiedAmount,
}: {
  accountNumber: string | null;
  gatewayReference: string;
  paystackResponse: Record<string, unknown>;
  supabase: SupabaseClient;
  verifiedAmount: { amount: number; currency?: string } | null;
}): Promise<ConfirmPaystackWalletDvaTopUpResult> {
  if (!accountNumber || !verifiedAmount) {
    return { kind: 'none' };
  }

  const walletAccount = await findCustomerWalletPaymentAccountByReceiver({
    receiverAccountNumber: accountNumber,
    supabase,
  });
  if (!walletAccount) {
    return { kind: 'none' };
  }

  const paidAt = getPaidAt(paystackResponse, gatewayReference);
  const aliasesActiveOrder = await hasActivePaystackOrderDvaAlias({
    accountNumber,
    asOf: paidAt,
    supabase,
  });

  if (aliasesActiveOrder) {
    await fileOrderAliasReview({
      accountNumber,
      gatewayReference,
      paidAt,
      supabase,
      verifiedAmount,
    });
    // Durable review is enough for operators; acknowledge so Paystack stops
    // redelivering an immutable alias conflict that cannot settle as wallet credit.
    return {
      body: {
        code: 'WALLET_DVA_ORDER_ALIAS_CONFLICT',
        error:
          'Receiver account is still reserved for an active order payment. Filed for manual reconciliation.',
      },
      kind: 'review',
      status: 200,
    };
  }

  const customerEmail = getCustomerEmail(paystackResponse);
  const metadata = {
    customer_email: customerEmail,
    customer_id: walletAccount.customerId,
    provider_account_id: walletAccount.providerAccountId,
    provider_customer_code: walletAccount.providerCustomerCode,
    transaction_type: WALLET_TOP_UP_TRANSACTION_TYPE,
    wallet_dva_account_number: accountNumber,
    wallet_payment_account_id: walletAccount.id,
  };

  const { data: transactionId, error: claimError } = await supabase.rpc(
    'claim_paystack_wallet_dva_transaction',
    {
      p_amount: verifiedAmount.amount,
      p_currency: verifiedAmount.currency ?? 'NGN',
      p_metadata: metadata,
      p_merchant_id: walletAccount.merchantId,
      p_reference: gatewayReference,
    }
  );

  if (claimError || typeof transactionId !== 'string') {
    throw claimError ?? new Error('Wallet DVA transaction claim failed');
  }

  const transaction = await readWalletDvaTransaction({
    transactionId,
    supabase,
  });

  // No telemetry here: this insert is only the PENDING transaction match. The
  // wallet is actually credited later by `creditWalletTopUp`, which emits
  // `wallet_funding_transfer_credited` on its fresh-credit path.
  return {
    kind: 'match',
    transaction: normalizeAgenticPaystackDvaTransaction(transaction),
  };
}

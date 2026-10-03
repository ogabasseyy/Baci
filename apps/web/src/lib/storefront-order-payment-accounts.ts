import {
  getPaystackDvaAccountNumberFromTransactions,
  type OrderPaymentAccountLike,
  selectPreferredOrderPaymentAccount,
} from '@baci/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toOrderPaymentAccount } from '@/lib/storefront-customer-payment-account-adapter';
import { loadStorefrontCustomerPaymentAccounts } from '@/lib/storefront-customer-payment-accounts';
import { loadStorefrontCustomerTransactions } from '@/lib/storefront-customer-transactions';
import type { Database } from '@/types/supabase';

interface StorefrontOrderPaymentAccountOrder {
  id: string;
  payment_status?: string | null;
  order_payment_accounts?: readonly OrderPaymentAccountLike[] | null;
  external_source?: string | null;
  import_job_id?: string | null;
  recorded_by_user_id?: string | null;
  total?: number | string | null;
  amount_paid?: number | string | null;
}

function needsCompletionTransactions(
  order: StorefrontOrderPaymentAccountOrder
): boolean {
  if (order.payment_status?.trim().toLowerCase() === 'paid') return true;
  // Receipt-substance manual orders settle under non-paid labels: a cheap
  // superset of the archive eligibility (balance covered, staff-recorded,
  // not imported) so their completing payment is available for dating.
  // Over-inclusion is harmless — the date selector filters settled rows.
  return (
    Boolean(order.recorded_by_user_id) &&
    !(order.external_source?.trim() || order.import_job_id) &&
    order.total != null &&
    order.amount_paid != null &&
    Number.isFinite(Number(order.total)) &&
    Number.isFinite(Number(order.amount_paid)) &&
    Number(order.amount_paid) >= Number(order.total)
  );
}

interface StorefrontOrderTransaction {
  order_id: string;
  created_at: string;
  metadata: unknown;
  gateway?: string | null;
  status?: string | null;
  transaction_type?: string | null;
}

/**
 * Resolve receipt accounts for a customer order list in one transaction
 * lookup, preserving the receiver recorded by a successful Paystack payment.
 * The loaded transactions are also returned so callers can date receipts
 * from the completing payment without a second lookup. Callers that need
 * transactions beyond paid-labeled orders pass explicit IDs.
 */
export async function resolveStorefrontOrderPaymentAccounts(
  supabase: SupabaseClient<Database>,
  orders: readonly StorefrontOrderPaymentAccountOrder[],
  now = new Date(),
  options?: { transactionOrderIds?: readonly string[] }
) {
  const transactionOrderIds =
    options?.transactionOrderIds ??
    orders.filter(needsCompletionTransactions).map((order) => order.id);
  const transactionsResult = await loadStorefrontCustomerTransactions(
    supabase,
    transactionOrderIds
  );
  const paymentAccountsResult = await loadStorefrontCustomerPaymentAccounts(
    supabase,
    orders.map((order) => order.id)
  );

  const transactionsByOrderId = new Map<string, StorefrontOrderTransaction[]>();
  for (const transaction of transactionsResult.data ?? []) {
    const orderTransactions =
      transactionsByOrderId.get(transaction.order_id) ?? [];
    orderTransactions.push(transaction);
    transactionsByOrderId.set(transaction.order_id, orderTransactions);
  }

  const customerPaymentAccountsByOrderId = new Map<
    string,
    OrderPaymentAccountLike[]
  >();
  for (const account of paymentAccountsResult.data ?? []) {
    const orderAccounts =
      customerPaymentAccountsByOrderId.get(account.order_id) ?? [];
    orderAccounts.push(toOrderPaymentAccount(account));
    customerPaymentAccountsByOrderId.set(account.order_id, orderAccounts);
  }

  const paymentAccountsByOrderId = new Map<
    string,
    OrderPaymentAccountLike | null
  >();
  for (const order of orders) {
    const isPaid = order.payment_status?.trim().toLowerCase() === 'paid';
    const account = selectPreferredOrderPaymentAccount(
      customerPaymentAccountsByOrderId.get(order.id) ??
        order.order_payment_accounts,
      now,
      {
        allowExpiredPaystackAccount: isPaid,
        preferredPaystackAccountNumber: isPaid
          ? getPaystackDvaAccountNumberFromTransactions(
              transactionsByOrderId.get(order.id)
            )
          : null,
      }
    );
    paymentAccountsByOrderId.set(order.id, account);
  }

  return {
    paymentAccountsByOrderId,
    paymentAccountError: paymentAccountsResult.error,
    transactionError: transactionsResult.error,
    transactionsByOrderId,
  };
}

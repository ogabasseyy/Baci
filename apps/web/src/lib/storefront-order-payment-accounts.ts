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
}

interface StorefrontOrderTransaction {
  order_id: string;
  metadata: unknown;
  gateway?: string | null;
  status?: string | null;
  transaction_type?: string | null;
}

/**
 * Resolve receipt accounts for a customer order list in one transaction
 * lookup, preserving the receiver recorded by a successful Paystack payment.
 */
export async function resolveStorefrontOrderPaymentAccounts(
  supabase: SupabaseClient<Database>,
  orders: readonly StorefrontOrderPaymentAccountOrder[],
  now = new Date()
) {
  const paidOrderIds = orders
    .filter((order) => order.payment_status?.trim().toLowerCase() === 'paid')
    .map((order) => order.id);
  const transactionsResult = await loadStorefrontCustomerTransactions(
    supabase,
    paidOrderIds
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
  };
}

import {
  getPaystackDvaAccountNumberFromTransactions,
  type OrderPaymentAccountLike,
  selectPreferredOrderPaymentAccount,
} from '@baci/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isManualOrderDocumentAvailable } from '@/lib/storefront-account-document-eligibility';
import { toOrderPaymentAccount } from '@/lib/storefront-customer-payment-account-adapter';
import { loadStorefrontCustomerPaymentAccounts } from '@/lib/storefront-customer-payment-accounts';
import {
  loadStorefrontCustomerTransactions,
  type StorefrontCustomerTransaction,
} from '@/lib/storefront-customer-transactions';
import type { Database } from '@/types/supabase';

interface StorefrontOrderPaymentAccountOrder {
  id: string;
  payment_status?: string | null;
  shipping_status?: string | null;
  order_payment_accounts?: readonly OrderPaymentAccountLike[] | null;
  external_source?: string | null;
  import_job_id?: string | null;
  recorded_by_user_id?: string | null;
  total?: number | string | null;
  subtotal?: number | string | null;
  shipping_fee?: number | string | null;
  tax_amount?: number | string | null;
  discount_amount?: number | string | null;
  amount_paid?: number | string | null;
  currency?: string | null;
  order_items?: readonly unknown[] | null;
}

function needsCompletionTransactions(
  order: StorefrontOrderPaymentAccountOrder
): boolean {
  if (order.payment_status?.trim().toLowerCase() === 'paid') return true;
  // Receipt-substance manual orders settle under non-paid labels: a cheap
  // superset of the archive eligibility (balance covered, staff-recorded,
  // not imported) so their completing payment is available for dating.
  // Over-inclusion is harmless — the date selector filters settled rows.
  const manualCovered =
    Boolean(order.recorded_by_user_id) &&
    !(order.external_source?.trim() || order.import_job_id) &&
    order.total != null &&
    order.amount_paid != null &&
    Number.isFinite(Number(order.total)) &&
    Number.isFinite(Number(order.amount_paid)) &&
    Number(order.amount_paid) >= Number(order.total);
  if (manualCovered) return true;
  // Manual invoices render their settled payments in the emailed
  // Payment table: load the same history so the archive preview neither
  // omits the payments behind a nonzero amount_paid nor advertises a
  // document the sender rejects. Zero-paid candidates load too: the
  // transactions table does not reconcile with orders.amount_paid, so a
  // settled row the sender rejects as payment_history_invalid can hide
  // behind a zero balance. The availability gate below still excludes
  // garbage-money and ineligible rows from the lookup.
  if (!order.recorded_by_user_id) {
    return false;
  }
  return isManualOrderDocumentAvailable({
    paymentStatus: order.payment_status,
    shippingStatus: order.shipping_status,
    externalSource: order.external_source,
    importJobId: order.import_job_id,
    recordedByUserId: order.recorded_by_user_id,
    total: order.total,
    amountPaid: order.amount_paid,
    money: {
      total: order.total,
      subtotal: order.subtotal,
      shipping_fee: order.shipping_fee,
      tax_amount: order.tax_amount,
      discount_amount: order.discount_amount,
      amount_paid: order.amount_paid,
      currency: order.currency,
    },
    items: (order.order_items ?? []) as Parameters<
      typeof isManualOrderDocumentAvailable
    >[0]['items'],
  });
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

  const transactionsByOrderId = new Map<
    string,
    StorefrontCustomerTransaction[]
  >();
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

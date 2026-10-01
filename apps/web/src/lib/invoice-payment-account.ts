import {
  getPaystackDvaAccountNumberFromTransactions,
  selectPreferredOrderPaymentAccount,
} from '@baci/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

type InvoicePaymentAccountRow = {
  account_number: string;
  assignment_customer_email_source?: string | null;
  bank_name: string | null;
  account_name: string | null;
  created_at?: string | null;
  assigned_at?: string | null;
  expires_at?: string | null;
  provider?: string | null;
};

const PAYMENT_ACCOUNT_COLUMNS =
  'account_number, bank_name, account_name, provider, assignment_customer_email_source, created_at, assigned_at, expires_at';

/**
 * Load the account that should be printed on an invoice while keeping the
 * query's payment-attempt and historical-document rules in one place.
 */
export async function resolveInvoicePaymentAccount(
  supabase: SupabaseClient<Database>,
  orderId: string,
  isPaidOrder: boolean,
  now = new Date()
) {
  let preferredPaystackAccountNumber: string | null = null;
  let transactionError: unknown = null;
  if (isPaidOrder) {
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('created_at, metadata, gateway, status, transaction_type')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });
    transactionError = error;
    preferredPaystackAccountNumber =
      getPaystackDvaAccountNumberFromTransactions(transactions);
  }

  let paymentAccountQuery = supabase
    .from('order_payment_accounts')
    .select(PAYMENT_ACCOUNT_COLUMNS)
    .eq('order_id', orderId)
    .eq('provider', 'paystack')
    .or(
      'assignment_customer_email_source.is.null,assignment_customer_email_source.neq.legacy_untrusted'
    );

  if (!isPaidOrder) {
    paymentAccountQuery = paymentAccountQuery.or(
      `expires_at.is.null,expires_at.gt.${now.toISOString()}`
    );
  }

  const orderedPaymentAccountQuery = paymentAccountQuery.order('created_at', {
    ascending: false,
  });
  const { data, error } = isPaidOrder
    ? await orderedPaymentAccountQuery
    : await orderedPaymentAccountQuery.limit(1);

  const rows = Array.isArray(data)
    ? (data as unknown as InvoicePaymentAccountRow[])
    : [];

  return {
    error,
    transactionError,
    paymentAccount: selectPreferredOrderPaymentAccount(rows, now, {
      allowExpiredPaystackAccount: isPaidOrder,
      allowMissingExpiryPaystackAccount: !isPaidOrder,
      preferredPaystackAccountNumber,
    }),
  };
}

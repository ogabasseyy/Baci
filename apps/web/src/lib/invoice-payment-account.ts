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

  // All providers: an order-specific Korapay (or other non-Paystack)
  // assignment must print on the emailed invoice exactly like the
  // authenticated download, which feeds every provider row to the shared
  // selector. Paystack still ranks first inside the selector; the query
  // only pre-filters rows no surface may print.
  let paymentAccountQuery = supabase
    .from('order_payment_accounts')
    .select(PAYMENT_ACCOUNT_COLUMNS)
    .eq('order_id', orderId)
    .or(
      'assignment_customer_email_source.is.null,assignment_customer_email_source.neq.legacy_untrusted'
    );

  // Future assignments are selector-invisible (assigned_at, else created_at,
  // must not exceed now): filter them at the database so the selector never
  // sees a row it would reject while starving the older eligible fallback.
  // Mirrors the atomic dispatch recheck (see the mark RPC).
  const assignmentCutoff = now.toISOString();
  paymentAccountQuery = paymentAccountQuery.or(
    `assigned_at.lte.${assignmentCutoff},and(assigned_at.is.null,created_at.lte.${assignmentCutoff}),and(assigned_at.is.null,created_at.is.null)`
  );

  if (!isPaidOrder) {
    // A 15-minute validity buffer: an account expiring mid-delivery would
    // embed unusable instructions with no mutation for a trigger to catch.
    // Mirrors the atomic dispatch recheck (see the mark RPC).
    const validityCutoff = new Date(now.getTime() + 15 * 60 * 1000);
    paymentAccountQuery = paymentAccountQuery.or(
      `expires_at.is.null,expires_at.gt.${validityCutoff.toISOString()}`
    );
  }

  // created_at ties when accounts share a transaction (now() is
  // transaction-stable): break them by account number, exactly like the
  // atomic dispatch recheck, so renderer and recheck never pick apart.
  // No LIMIT: the shared selector ranks an eligible Paystack row above a
  // newer non-Paystack row, so it must see every eligible row — LIMIT 1
  // newest could return a Korapay row the selector would not pick.
  const orderedPaymentAccountQuery = paymentAccountQuery
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('account_number', { ascending: false });
  const { data, error } = await orderedPaymentAccountQuery;

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

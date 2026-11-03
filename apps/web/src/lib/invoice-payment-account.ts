import type { PaystackDvaTransactionLike } from '@baci/shared';
import {
  getPaystackDvaAccountNumberFromTransactions,
  selectPreferredOrderPaymentAccount,
} from '@baci/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

type InvoicePaymentAccountRow = {
  id: string;
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
  'id, account_number, bank_name, account_name, provider, assignment_customer_email_source, created_at, assigned_at, expires_at';

const UNPAID_EXPIRY_BUFFER_MS = 15 * 60 * 1000;

type SnapshotPaymentAccountRow = {
  id?: unknown;
  account_number?: unknown;
  assignment_customer_email_source?: unknown;
  bank_name?: unknown;
  account_name?: unknown;
  created_at?: unknown;
  assigned_at?: unknown;
  expires_at?: unknown;
  provider?: unknown;
};

/**
 * Pure account-selection core shared by the staff download (database rows)
 * and the manual sender (claim-bound snapshot rows): the database
 * pre-filters below, the snapshot RPC returns every row for the order, and
 * this function applies the same eligibility rules to both so renderer
 * and recheck never pick apart. Filters mirror the atomic dispatch
 * recheck (see the mark RPC): untrusted legacy assignments are
 * selector-invisible, future assignments starve no eligible fallback,
 * and unpaid sends keep a 15-minute expiry buffer.
 */
export function selectInvoicePaymentAccountForRows(
  paymentAccounts: readonly unknown[],
  transactions: readonly PaystackDvaTransactionLike[],
  isPaidOrder: boolean,
  now = new Date()
): InvoicePaymentAccountRow | null {
  const cutoff = now.toISOString();
  const validityCutoff = new Date(
    now.getTime() + UNPAID_EXPIRY_BUFFER_MS
  ).toISOString();
  const eligible = (paymentAccounts as SnapshotPaymentAccountRow[]).filter(
    (row) => {
      if (row.assignment_customer_email_source === 'legacy_untrusted')
        return false;
      const assignedAt =
        typeof row.assigned_at === 'string' ? row.assigned_at : null;
      const createdAt =
        typeof row.created_at === 'string' ? row.created_at : null;
      if (assignedAt != null) {
        if (assignedAt > cutoff) return false;
      } else if (createdAt != null) {
        if (createdAt > cutoff) return false;
      }
      if (!isPaidOrder) {
        const expiresAt =
          typeof row.expires_at === 'string' ? row.expires_at : null;
        if (expiresAt != null && expiresAt <= validityCutoff) return false;
      }
      return true;
    }
  );
  const ordered = [...eligible].sort((left, right) => {
    const leftCreated =
      typeof left.created_at === 'string' ? left.created_at : null;
    const rightCreated =
      typeof right.created_at === 'string' ? right.created_at : null;
    if (leftCreated !== rightCreated) {
      if (leftCreated == null) return 1;
      if (rightCreated == null) return -1;
      return leftCreated < rightCreated ? 1 : -1;
    }
    const leftNumber = String(left.account_number ?? '');
    const rightNumber = String(right.account_number ?? '');
    if (leftNumber !== rightNumber) return leftNumber < rightNumber ? 1 : -1;
    const leftId = String(left.id ?? '');
    const rightId = String(right.id ?? '');
    if (leftId !== rightId) return leftId < rightId ? 1 : -1;
    return 0;
  });
  return selectPreferredOrderPaymentAccount(
    ordered as unknown as InvoicePaymentAccountRow[],
    now,
    {
      allowExpiredPaystackAccount: isPaidOrder,
      allowMissingExpiryPaystackAccount: !isPaidOrder,
      expiryBufferMs: isPaidOrder ? undefined : UNPAID_EXPIRY_BUFFER_MS,
      preferredPaystackAccountNumber: isPaidOrder
        ? getPaystackDvaAccountNumberFromTransactions(transactions)
        : null,
    }
  );
}

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
  let lastTransactions: readonly PaystackDvaTransactionLike[] = [];
  let transactionError: unknown = null;
  if (isPaidOrder) {
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('created_at, metadata, gateway, status, transaction_type')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });
    transactionError = error;
    lastTransactions = Array.isArray(transactions)
      ? (transactions as PaystackDvaTransactionLike[])
      : [];
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

  // A 15-minute validity buffer: an account expiring mid-delivery would
  // embed unusable instructions with no mutation for a trigger to catch.
  // Mirrors the atomic dispatch recheck (see the mark RPC). Passed to the
  // selector as well so both encode the same rule for unpaid sends.
  if (!isPaidOrder) {
    const validityCutoff = new Date(now.getTime() + UNPAID_EXPIRY_BUFFER_MS);
    paymentAccountQuery = paymentAccountQuery.or(
      `expires_at.is.null,expires_at.gt.${validityCutoff.toISOString()}`
    );
  }

  // created_at ties when accounts share a transaction (now() is
  // transaction-stable): break them by account number, then row id,
  // exactly like the atomic dispatch recheck, so renderer and recheck
  // never pick apart. No LIMIT: the shared selector ranks an eligible
  // Paystack row above a newer non-Paystack row, so it must see every
  // eligible row — LIMIT 1 newest could return a Korapay row the
  // selector would not pick.
  const orderedPaymentAccountQuery = paymentAccountQuery
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('account_number', { ascending: false })
    .order('id', { ascending: false });
  const { data, error } = await orderedPaymentAccountQuery;

  const rows = Array.isArray(data) ? data : [];
  // Selection runs through the shared pure core (the SQL pre-filters
  // above are idempotent under it) so the staff download and the manual
  // sender pick identically.
  return {
    error,
    transactionError,
    paymentAccount: selectInvoicePaymentAccountForRows(
      rows,
      lastTransactions,
      isPaidOrder,
      now
    ),
  };
}

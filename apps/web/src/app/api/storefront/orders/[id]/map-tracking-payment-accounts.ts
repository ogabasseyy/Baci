import type { OrderPaymentAccountLike } from '@baci/shared';

interface TrackingPaymentAccountRow {
  account_number: unknown;
  bank_name?: unknown;
  account_name?: unknown;
  provider?: unknown;
  assignment_customer_email_source?: unknown;
  created_at?: unknown;
  assigned_at?: unknown;
  expires_at?: unknown;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Maps proof-bound `get_order_tracking` payment-account rows onto the
 * shared preferred-account selector input. Rows without an account
 * number are dropped: the selector requires it, and a numberless row
 * can never render payable instructions.
 */
export function mapTrackingPaymentAccounts(
  rows: unknown
): OrderPaymentAccountLike[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  const accounts: OrderPaymentAccountLike[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const candidate = row as TrackingPaymentAccountRow;
    if (
      typeof candidate.account_number !== 'string' ||
      !candidate.account_number
    ) {
      continue;
    }
    accounts.push({
      account_number: candidate.account_number,
      bank_name: asNullableString(candidate.bank_name),
      account_name: asNullableString(candidate.account_name),
      provider: asNullableString(candidate.provider),
      assignment_customer_email_source: asNullableString(
        candidate.assignment_customer_email_source
      ),
      created_at: asNullableString(candidate.created_at),
      assigned_at: asNullableString(candidate.assigned_at),
      expires_at: asNullableString(candidate.expires_at),
    });
  }
  return accounts;
}

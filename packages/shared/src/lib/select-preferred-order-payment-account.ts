export interface OrderPaymentAccountLike {
  account_name: string | null;
  account_number: string;
  assignment_customer_email_source?: string | null;
  assigned_at?: string | null;
  bank_name: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  provider?: string | null;
}

const PAYSTACK_DVA_WINDOW_MS = 90 * 60 * 1000;
const PAYSTACK_DVA_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface SelectPreferredOrderPaymentAccountOptions {
  /**
   * Allow a bounded assignment-window grace period for clients whose local
   * clock may lag the server clock. Keep this disabled for server consumers.
   */
  allowDeviceClockSkew?: boolean;
  /**
   * Keep an expired Paystack alias available for a paid document's historical
   * payment instructions. Never enable this for a new payment attempt.
   */
  allowExpiredPaystackAccount?: boolean;
  /**
   * Preserve legacy Paystack rows that never received an explicit expiry.
   * Explicitly expired rows remain hidden unless historical mode is enabled.
   */
  allowMissingExpiryPaystackAccount?: boolean;
  /**
   * Account recorded on the successful Paystack transaction for a paid
   * document. This takes precedence over alias recency when the matching
   * account is still an eligible historical row.
   */
  preferredPaystackAccountNumber?: string | null;
}

function isActivePaystackAccount(
  account: OrderPaymentAccountLike,
  nowMs: number,
  {
    allowDeviceClockSkew = false,
    allowExpiredPaystackAccount = false,
    allowMissingExpiryPaystackAccount = false,
  }: SelectPreferredOrderPaymentAccountOptions
) {
  if (account.provider !== 'paystack') return true;
  if (account.assignment_customer_email_source === 'legacy_untrusted') {
    return false;
  }

  const assignedAt = account.assigned_at
    ? Date.parse(account.assigned_at)
    : account.created_at
      ? Date.parse(account.created_at)
      : Number.NaN;
  const expiresAt = account.expires_at
    ? Date.parse(account.expires_at)
    : Number.NaN;
  const hasExplicitExpiry = Number.isFinite(expiresAt);
  const assignmentUpperBound = Number.isFinite(expiresAt)
    ? expiresAt
    : Number.isFinite(assignedAt)
      ? assignedAt + PAYSTACK_DVA_WINDOW_MS
      : Number.NaN;

  // A future assignment must never become visible just because a caller is
  // rendering a historical paid document. Mobile clients may still use the
  // bounded device-clock grace that applies to active assignments.
  if (
    Number.isFinite(assignedAt) &&
    nowMs < assignedAt - (allowDeviceClockSkew ? PAYSTACK_DVA_CLOCK_SKEW_MS : 0)
  ) {
    return false;
  }

  if (hasExplicitExpiry && nowMs >= expiresAt) {
    return allowExpiredPaystackAccount;
  }

  if (
    !hasExplicitExpiry &&
    Number.isFinite(assignedAt) &&
    nowMs > assignmentUpperBound
  ) {
    return allowExpiredPaystackAccount || allowMissingExpiryPaystackAccount;
  }

  return (
    !Number.isFinite(assignedAt) ||
    (nowMs >=
      assignedAt - (allowDeviceClockSkew ? PAYSTACK_DVA_CLOCK_SKEW_MS : 0) &&
      nowMs <=
        assignmentUpperBound +
          (hasExplicitExpiry || !allowDeviceClockSkew
            ? 0
            : PAYSTACK_DVA_CLOCK_SKEW_MS))
  );
}

/**
 * Select one account deterministically when an order has legacy and current
 * provider rows. Paystack is preferred because it is the only provider whose
 * DVA rows are matched by the Paystack webhook; otherwise the newest row wins.
 */
export function selectPreferredOrderPaymentAccount<
  T extends OrderPaymentAccountLike,
>(
  accounts: readonly T[] | null | undefined,
  now = new Date(),
  options: SelectPreferredOrderPaymentAccountOptions = {}
): T | null {
  if (!accounts || accounts.length === 0) {
    return null;
  }

  const eligibleAccounts = accounts.filter((account) =>
    isActivePaystackAccount(account, now.getTime(), options)
  );
  const preferredAccountNumber =
    options.preferredPaystackAccountNumber?.trim();
  if (preferredAccountNumber && /^\d{6,20}$/.test(preferredAccountNumber)) {
    const preferredAccount = eligibleAccounts.find(
      (account) =>
        account.provider === 'paystack' &&
        account.account_number.trim() === preferredAccountNumber
    );
    if (preferredAccount) {
      return preferredAccount;
    }
  }

  return (
    eligibleAccounts
      .sort((left, right) => {
        const leftProviderRank = left.provider === 'paystack' ? 0 : 1;
        const rightProviderRank = right.provider === 'paystack' ? 0 : 1;
        if (leftProviderRank !== rightProviderRank) {
          return leftProviderRank - rightProviderRank;
        }

        const leftCreatedAt = left.created_at
          ? Date.parse(left.created_at)
          : Number.NaN;
        const rightCreatedAt = right.created_at
          ? Date.parse(right.created_at)
          : Number.NaN;
        const leftCreatedAtMs = Number.isFinite(leftCreatedAt)
          ? leftCreatedAt
          : Number.NEGATIVE_INFINITY;
        const rightCreatedAtMs = Number.isFinite(rightCreatedAt)
          ? rightCreatedAt
          : Number.NEGATIVE_INFINITY;
        if (leftCreatedAtMs !== rightCreatedAtMs) {
          return rightCreatedAtMs - leftCreatedAtMs;
        }

        return left.account_number.localeCompare(right.account_number);
      })[0] ?? null
  );
}

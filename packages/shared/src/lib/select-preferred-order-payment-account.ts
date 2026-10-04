export interface OrderPaymentAccountLike {
  account_name: string | null;
  account_number: string;
  assignment_customer_email_source?: string | null;
  assigned_at?: string | null;
  bank_name: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  id?: string | null;
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
   * (Applies to every provider's explicit expiry; the name is historical.)
   */
  allowExpiredPaystackAccount?: boolean;
  /**
   * Delivery-window buffer for explicit expiries, in milliseconds: a row
   * expiring within the buffer reads as expired. The email sender passes
   * its 15-minute buffer so an account expiring mid-delivery is never
   * printed; live reads leave the default zero. The atomic dispatch
   * recheck mirrors the sender buffer in SQL.
   */
  expiryBufferMs?: number;
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

function isActiveOrderPaymentAccount(
  account: OrderPaymentAccountLike,
  nowMs: number,
  {
    allowDeviceClockSkew = false,
    allowExpiredPaystackAccount = false,
    allowMissingExpiryPaystackAccount = false,
    expiryBufferMs = 0,
  }: SelectPreferredOrderPaymentAccountOptions
) {
  // Legacy-untrusted assignments print on no surface: the assignment email
  // cannot be trusted regardless of provider. The sender and the atomic
  // recheck filter these at the database; the selector enforces the same
  // rule for the loaders that pass unfiltered rows.
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

  // A future assignment must never become visible just because a caller is
  // rendering a historical paid document. Mobile clients may still use the
  // bounded device-clock grace that applies to active assignments.
  if (
    Number.isFinite(assignedAt) &&
    nowMs < assignedAt - (allowDeviceClockSkew ? PAYSTACK_DVA_CLOCK_SKEW_MS : 0)
  ) {
    return false;
  }

  if (account.provider !== 'paystack') {
    // Non-Paystack rows have no DVA matching window: only an explicit
    // expiry in the past disqualifies them, and rows without one stay
    // eligible. Live reads use exact expiry; the email sender passes its
    // delivery buffer so the same function encodes the sender rule too.
    if (!hasExplicitExpiry) return true;
    if (nowMs + expiryBufferMs >= expiresAt) {
      return allowExpiredPaystackAccount;
    }
    return true;
  }

  const assignmentUpperBound = Number.isFinite(expiresAt)
    ? expiresAt
    : Number.isFinite(assignedAt)
      ? assignedAt + PAYSTACK_DVA_WINDOW_MS
      : Number.NaN;

  if (hasExplicitExpiry && nowMs + expiryBufferMs >= expiresAt) {
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
 * Eligibility (legacy, future, expiry) applies to every provider so loaders
 * that pass unfiltered rows agree with the sender's pre-filtered query.
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
    isActiveOrderPaymentAccount(account, now.getTime(), options)
  );
  const preferredAccountNumber = options.preferredPaystackAccountNumber?.trim();
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
    eligibleAccounts.sort((left, right) => {
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

      // created_at ties when accounts share a transaction (now() is
      // transaction-stable): break them by account number descending,
      // exactly like the emailed-invoice selector and the atomic dispatch
      // recheck, so every surface embeds the same account.
      const accountNumberTie = right.account_number.localeCompare(
        left.account_number
      );
      if (accountNumberTie !== 0) {
        return accountNumberTie;
      }
      // Duplicate account numbers with divergent metadata are
      // database-permitted: break the tie by row id descending, exactly
      // like the atomic dispatch recheck, so independently ordered
      // result sets never pick different rows. Rows without an id sort
      // last; surfaces must select id for full determinism.
      return String(right.id ?? '').localeCompare(String(left.id ?? ''));
    })[0] ?? null
  );
}

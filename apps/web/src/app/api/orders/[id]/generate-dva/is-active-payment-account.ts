import { PAYSTACK_DVA_WINDOW_MS } from './paystack-dva-window';

type PaymentAccountTiming = {
  assignment_customer_email_source?: string | null;
  assigned_at?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  provider?: string | null;
};

export function isActivePaymentAccount(
  account: PaymentAccountTiming,
  now = new Date()
): boolean {
  if (account.provider !== 'paystack') {
    return true;
  }
  if (account.assignment_customer_email_source === 'legacy_untrusted') {
    return false;
  }

  const nowMs = now.getTime();
  const expiresAt = account.expires_at
    ? Date.parse(account.expires_at)
    : Number.NaN;
  if (Number.isFinite(expiresAt) && nowMs >= expiresAt) {
    return false;
  }

  const assignedAt = account.assigned_at
    ? Date.parse(account.assigned_at)
    : account.created_at
      ? Date.parse(account.created_at)
      : Number.NaN;
  if (!Number.isFinite(assignedAt)) {
    return true;
  }

  if (nowMs < assignedAt) {
    return false;
  }

  // Persisted invoice assignments may intentionally outlive the default
  // provisioning window. When an expiry is supplied, it is authoritative.
  if (Number.isFinite(expiresAt)) {
    return true;
  }

  return nowMs <= assignedAt + PAYSTACK_DVA_WINDOW_MS;
}

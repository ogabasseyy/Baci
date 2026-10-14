import type { CartItemIdentity, CartSnapshot } from '@baci/shared/cart';

export interface PreviewMerchant {
  id: string;
  slug: string | null;
}

export interface PreviewResponse {
  status: 'pending' | 'consumed' | 'expired';
  merchant: PreviewMerchant | null;
  snapshot: CartSnapshot | null;
  expiresAt: string | null;
  code?: string;
}

export interface ConflictOption {
  quantity?: number;
  voucherToken?: string | null;
  voucherAwardId?: string | null;
  negotiatedUnitPriceMinor?: number | null;
  negotiationStatus?: string | null;
}

export interface MergeConflictView {
  item: CartItemIdentity;
  existing: ConflictOption;
  incoming: ConflictOption;
}

export type Choice = 'connect' | 'merge' | 'keep_existing';

export function attemptStorageKey(handoffId: string): string {
  return `baci-cart-handoff-attempt:${handoffId}`;
}

export function loadOrCreateAttemptId(handoffId: string): string {
  const key = attemptStorageKey(handoffId);
  const stored = window.localStorage.getItem(key);
  if (stored) return stored;
  const attemptId =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, attemptId);
  return attemptId;
}

export function formatMinor(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', {
      currency,
      style: 'currency',
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export function describeOption(
  option: ConflictOption,
  currency: string
): string {
  const parts = [`${option.quantity ?? 1} × item`];
  if (option.negotiatedUnitPriceMinor != null) {
    parts.push(
      `negotiated ${formatMinor(option.negotiatedUnitPriceMinor, currency)}`
    );
  }
  if (option.voucherToken) parts.push('with voucher');
  if (option.negotiationStatus) parts.push(option.negotiationStatus);
  return parts.join(', ');
}

export function fetchJson(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { referrerPolicy: 'no-referrer', ...init });
}

import type { CartItemIdentity, CartSnapshot } from '@baci/shared/cart';
import {
  type CartMergeResolution,
  cartLineIdentity,
  planCartMerge,
} from '@baci/shared/cart';

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
  hasVoucher?: boolean;
  hasNegotiation?: boolean;
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

const attemptIds = new Map<string, string>();

export function loadOrCreateAttemptId(handoffId: string): string {
  const key = attemptStorageKey(handoffId);
  try {
    const stored = window.localStorage.getItem(key);
    if (stored) {
      attemptIds.set(key, stored);
      return stored;
    }
  } catch {
    /* Storage is optional; preserve retry identity in this tab. */
  }
  const attemptId =
    attemptIds.get(key) ??
    (typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  attemptIds.set(key, attemptId);
  try {
    window.localStorage.setItem(key, attemptId);
  } catch {
    /* Use the tab cache. */
  }
  return attemptId;
}

const attemptChoices = new Map<string, Choice>();

function attemptChoiceStorageKey(handoffId: string): string {
  return `${attemptStorageKey(handoffId)}:choice`;
}

/**
 * The choice an unresolved attempt is locked to. The redeem RPC
 * replays solely by attempt id, so retrying with a different choice
 * would silently apply the original redemption; the first choice is
 * recorded and later different choices are refused until the outcome
 * is definitive.
 */
export function lockedAttemptChoice(handoffId: string): Choice | null {
  const key = attemptChoiceStorageKey(handoffId);
  const cached = attemptChoices.get(key);
  if (cached) return cached;
  try {
    const stored = window.localStorage.getItem(key);
    if (
      stored === 'connect' ||
      stored === 'merge' ||
      stored === 'keep_existing'
    ) {
      attemptChoices.set(key, stored);
      return stored;
    }
  } catch {
    /* Storage is optional; the tab cache still locks the choice. */
  }
  return null;
}

export function recordAttemptChoice(handoffId: string, choice: Choice): void {
  const key = attemptChoiceStorageKey(handoffId);
  attemptChoices.set(key, choice);
  try {
    window.localStorage.setItem(key, choice);
  } catch {
    /* Use the tab cache. */
  }
}

/** Redemption already committed; optional browser cleanup cannot undo success. */
export function clearHandoffAttempt(handoffId: string): void {
  const key = attemptStorageKey(handoffId);
  attemptIds.delete(key);
  attemptChoices.delete(attemptChoiceStorageKey(handoffId));
  try {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(attemptChoiceStorageKey(handoffId));
  } catch {
    /* Storage may be disabled. */
  }
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
  if (option.hasNegotiation && option.negotiatedUnitPriceMinor == null)
    parts.push('with negotiated offer');
  if (option.hasVoucher || option.voucherToken) parts.push('with voucher');
  if (option.negotiationStatus) parts.push(option.negotiationStatus);
  return parts.join(', ');
}

export function fetchJson(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { referrerPolicy: 'no-referrer', ...init });
}

/** Remove pairing secrets while preserving the shopper's path and query. */
export function redactHandoffFragment() {
  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search
  );
}

/** Picks recorded against the current conflict set, as merge resolutions. */
export function mergeResolutionList(
  conflicts: MergeConflictView[],
  resolutions: Record<string, 'incoming' | 'existing'>
): CartMergeResolution[] {
  return conflicts
    .filter((conflict) => resolutions[cartLineIdentity(conflict.item)])
    .map((conflict) => ({
      item: conflict.item,
      keep: resolutions[cartLineIdentity(conflict.item)] as
        | 'incoming'
        | 'existing',
    }));
}

/** Every recorded pick as a resolution, resolving items from conflicts. */
export function recordResolutionList(
  conflicts: MergeConflictView[],
  resolutions: Record<string, 'incoming' | 'existing'>
): CartMergeResolution[] {
  return Object.entries(resolutions).map(([key, keep]) => ({
    item: conflicts.find((conflict) => cartLineIdentity(conflict.item) === key)
      ?.item ?? { productId: key },
    keep,
  }));
}

/** Public previews carry opaque line ids; SQL reconstructs private offer lanes. */
export function planHandoffMerge(
  existing: CartSnapshot,
  incoming: CartSnapshot,
  resolutions: CartMergeResolution[] = []
) {
  return planCartMerge(existing, incoming, resolutions, {
    handoffReferences: true,
  });
}

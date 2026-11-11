import { stableStringify } from '@/lib/stable-stringify';

/** Compare older saved attempts without their refreshable shipping quote UUID. */
export function checkoutFingerprintsMatch(
  left: string,
  right: string,
  confirmedWalletDebit?: number
): boolean {
  if (left === right) return true;
  const normalize = (value: string): string => {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return value;
      const {
        selectedQuoteId: _quote,
        merchantRateId = null,
        giftWrappingCost = 0,
        items,
        ...checkout
      } = parsed as Record<string, unknown>;
      const normalizedItems = Array.isArray(items) ? items.map((item: unknown) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        const { variantId, variantAttributes, ...rest } = item as Record<string, unknown>;
        return { ...rest, variantId: variantId || null, variantAttributes: variantAttributes ?? {} };
      }) : items;
      return stableStringify({
        ...checkout,
        items: normalizedItems,
        merchantRateId,
        giftWrappingCost: giftWrappingCost || 0,
      });
    } catch {
      return value;
    }
  };
  return (
    normalize(left) === normalize(right) ||
    matchesConfirmedWalletDebit(left, right, confirmedWalletDebit)
  );
}

function readFingerprint(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Save the ledger-confirmed debit on a financing checkpoint. */
export function withConfirmedWalletDebit(fingerprint: string, debit: number): string {
  const checkout = readFingerprint(fingerprint);
  return checkout
    ? stableStringify({ ...checkout, useWalletCredit: true, walletAmountUsed: debit })
    : fingerprint;
}

/** A refresh may clear the selection or show the actual debit instead of the request. */
function matchesConfirmedWalletDebit(
  savedFingerprint: string,
  currentFingerprint: string,
  confirmedWalletDebit: number | undefined
): boolean {
  if (
    confirmedWalletDebit === undefined ||
    !Number.isFinite(confirmedWalletDebit) ||
    confirmedWalletDebit <= 0
  ) {
    return false;
  }
  const saved = readFingerprint(savedFingerprint);
  const current = readFingerprint(currentFingerprint);
  if (
    !saved || !current ||
    saved.useWalletCredit !== true ||
    typeof saved.walletAmountUsed !== 'number' ||
    saved.walletAmountUsed < confirmedWalletDebit ||
    typeof current.useWalletCredit !== 'boolean' ||
    (current.walletAmountUsed !== 0 &&
      (current.useWalletCredit !== true || current.walletAmountUsed !== confirmedWalletDebit))
  ) {
    return false;
  }
  return checkoutFingerprintsMatch(
    withConfirmedWalletDebit(savedFingerprint, confirmedWalletDebit),
    withConfirmedWalletDebit(currentFingerprint, confirmedWalletDebit)
  );
}

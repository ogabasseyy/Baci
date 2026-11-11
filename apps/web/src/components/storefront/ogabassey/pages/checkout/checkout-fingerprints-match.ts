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
        requestedWalletAmount: _request,
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

function readRequestedWalletAmount(checkout: Record<string, unknown> | null) {
  if (checkout?.useWalletCredit !== true) return undefined;
  const amount = checkout.requestedWalletAmount ?? checkout.walletAmountUsed;
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : undefined;
}

/** Save the confirmed debit and remember the original request for display lag. */
export function withConfirmedWalletDebit(
  fingerprint: string,
  debit: number,
  previousFingerprint?: string
): string {
  const checkout = readFingerprint(fingerprint);
  if (!checkout) return fingerprint;

  const requested = previousFingerprint
    ? readRequestedWalletAmount(readFingerprint(previousFingerprint))
    : readRequestedWalletAmount(checkout);
  return stableStringify({
    ...checkout,
    useWalletCredit: true,
    walletAmountUsed: debit,
    ...(requested !== undefined && requested > debit ? { requestedWalletAmount: requested } : {}),
  });
}

/** Wallet display may show zero, the confirmed debit, or the original request. */
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
  const requested = readRequestedWalletAmount(saved);
  if (
    !saved || !current ||
    saved.useWalletCredit !== true ||
    typeof saved.walletAmountUsed !== 'number' ||
    !Number.isFinite(saved.walletAmountUsed) ||
    saved.walletAmountUsed < confirmedWalletDebit ||
    typeof current.useWalletCredit !== 'boolean' ||
    (current.walletAmountUsed !== 0 &&
      (current.useWalletCredit !== true ||
        (current.walletAmountUsed !== confirmedWalletDebit &&
          !(requested !== undefined && requested >= confirmedWalletDebit && current.walletAmountUsed === requested))))
  ) {
    return false;
  }
  return checkoutFingerprintsMatch(
    withConfirmedWalletDebit(savedFingerprint, confirmedWalletDebit),
    withConfirmedWalletDebit(currentFingerprint, confirmedWalletDebit)
  );
}

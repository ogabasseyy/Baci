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
      return JSON.stringify({
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

/** A refresh may clear wallet selection after a confirmed debit consumed the balance. */
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
  try {
    const before: unknown = JSON.parse(savedFingerprint);
    const after: unknown = JSON.parse(currentFingerprint);
    if (
      !before ||
      !after ||
      typeof before !== 'object' ||
      typeof after !== 'object' ||
      Array.isArray(before) ||
      Array.isArray(after)
    )
      return false;
    const oldCheckout = before as Record<string, unknown>;
    const newCheckout = after as Record<string, unknown>;
    return (
      oldCheckout.useWalletCredit === true &&
      typeof newCheckout.useWalletCredit === 'boolean' &&
      oldCheckout.walletAmountUsed === confirmedWalletDebit &&
      newCheckout.walletAmountUsed === 0 &&
      checkoutFingerprintsMatch(
        JSON.stringify(oldCheckout),
        JSON.stringify({
          ...newCheckout,
          useWalletCredit: true,
          walletAmountUsed: confirmedWalletDebit,
        })
      )
    );
  } catch {
    return false;
  }
}

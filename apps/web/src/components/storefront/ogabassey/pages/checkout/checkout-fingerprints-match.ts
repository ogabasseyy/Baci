/** Compare older saved attempts without their refreshable shipping quote UUID. */
export function checkoutFingerprintsMatch(
  left: string,
  right: string
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
  return normalize(left) === normalize(right);
}

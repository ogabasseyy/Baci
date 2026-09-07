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
      const { selectedQuoteId: _quote, merchantRateId = null, ...checkout } = parsed as Record<
        string,
        unknown
      >;
      return JSON.stringify({ ...checkout, merchantRateId });
    } catch {
      return value;
    }
  };
  return normalize(left) === normalize(right);
}

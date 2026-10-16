// Mirror the RPC's ±1 NGN parity tolerance so display rounding is not treated
// as a price change.
const PRICE_TOLERANCE = 1;

// Mirror roundToCents in the order validators: checkout compares EXTENDED
// line totals, so drift detection must use the same line basis.
function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function hasLinePriceDrift(
  liveUnitPrice: number,
  cartUnitPrice: number,
  quantity: number
): boolean {
  const units =
    Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
  return (
    Math.abs(
      roundToCents(liveUnitPrice * units) - roundToCents(cartUnitPrice * units)
    ) > PRICE_TOLERANCE
  );
}

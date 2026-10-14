// Mirror calculate_loyalty_tier's threshold reading (migration 04): a
// threshold counts iff it is an integer in range, exactly like the SQL
// ^-?[0-9]+$ NUMERIC compare (digit strings coerce; decimals, unsafe
// magnitudes, and non-numeric values are unusable and never match, so
// they return null here and the caller drops the rung — flooring them
// to 0 would invent a rung SQL never assigns).
export interface LadderRung {
  name: string;
  minPoints: number;
}

// Collapse duplicate case-insensitive names (merchant JSON can repeat a
// name at several thresholds), keeping the lowest rung per name. Without
// this the route's findIndex/slice progression reports the member's own
// tier as next ("points to Silver" while Silver).
export function dedupeLadderByName<T extends LadderRung>(
  ladder: readonly T[]
): T[] {
  const seen = new Set<string>();
  return ladder.filter((entry) => {
    const key = entry.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Mirror award_purchase_points' multiplier reading (migration 03):
// tier->>'multiplier' extracts JSON numbers and numeric strings alike
// as text, and the ^-?[0-9]+(\.[0-9]+)?$ grammar casts both. Legacy
// rows the old unvalidated endpoint persisted can therefore carry
// "2" while earning at 2x; the status payload must coerce the same
// grammar instead of nulling it, or the UI hides a live benefit.
// Anything else (text, booleans, unsafe magnitudes) is unusable.
const MULTIPLIER_PATTERN = /^-?[0-9]+(\.[0-9]+)?$/;

export function toLadderMultiplier(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && MULTIPLIER_PATTERN.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toLadderThreshold(value: unknown): number | null {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    Number.isSafeInteger(value)
  )
    return value;
  if (
    typeof value === 'string' &&
    /^-?[0-9]+$/.test(value) &&
    Number.isSafeInteger(Number(value))
  )
    return Number(value);
  return null;
}

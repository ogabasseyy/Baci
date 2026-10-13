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

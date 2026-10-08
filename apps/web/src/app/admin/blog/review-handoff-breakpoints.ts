// Responsive breakpoint model for joint per-viewport evaluation.
// Points 0-5 are the base, sm, md, lg, xl, and 2xl intervals.
// Stylesheet rank (Tailwind v4.3.1 compiled order, verified): base,
// then max-* variants from widest to narrowest, then min-width
// variants ascending. Min-width layers apply upward; max-* layers
// apply strictly below their threshold.
export const BREAKPOINT_POINT_COUNT = 6;

const LAYER_RANK: Record<string, number> = {
  '': 0,
  'max-2xl:': 1,
  'max-xl:': 2,
  'max-lg:': 3,
  'max-md:': 4,
  'max-sm:': 5,
  'sm:': 6,
  'md:': 7,
  'lg:': 8,
  'xl:': 9,
  '2xl:': 10,
};

const MIN_WIDTH_FLOOR: Record<string, number> = {
  'sm:': 1,
  'md:': 2,
  'lg:': 3,
  'xl:': 4,
  '2xl:': 5,
};

const MAX_WIDTH_CEILING: Record<string, number> = {
  'max-sm:': 1,
  'max-md:': 2,
  'max-lg:': 3,
  'max-xl:': 4,
  'max-2xl:': 5,
};

function layerAppliesAt(layer: string, point: number): boolean {
  if (layer === '') return true;
  if (layer.startsWith('max-')) {
    return point < (MAX_WIDTH_CEILING[layer] ?? 0);
  }
  return point >= (MIN_WIDTH_FLOOR[layer] ?? Number.POSITIVE_INFINITY);
}

/**
 * Latest applicable per-layer winner at one evaluation point: the
 * entry from the highest-ranked layer covering that viewport.
 * Callers pre-resolve same-layer conflicts; unknown layers never win.
 */
export function breakpointWinnerAtPoint<T>(
  winners: ReadonlyMap<string, T>,
  point: number
): T | undefined {
  let best: T | undefined;
  let bestRank = -1;
  for (const [layer, winner] of winners) {
    const rank = LAYER_RANK[layer] ?? -1;
    if (rank > bestRank && layerAppliesAt(layer, point)) {
      best = winner;
      bestRank = rank;
    }
  }
  return best;
}

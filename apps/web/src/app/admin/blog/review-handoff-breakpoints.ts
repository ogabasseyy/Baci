// Responsive breakpoint model for joint per-viewport evaluation.
// Points 0-5 are the base, sm, md, lg, xl, and 2xl intervals.
// Stylesheet rank (Tailwind v4.3.1 compiled order, verified): base,
// then max-* variants from widest to narrowest, then min-width
// variants ascending. Min-width layers apply upward; max-* layers
// apply strictly below their threshold. Color-scheme variants
// evaluate as a second run: `dark:` utilities compile to `.dark`
// selectors whose extra class outranks every width-only layer, so
// they form a ranked layer above the width scale that applies only
// in the dark run. Content readable in either scheme is readable.
export const BREAKPOINT_POINT_COUNT = 6;

export type ColorScheme = 'light' | 'dark';

const DARK_RANK_BONUS = 100;

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

function splitScheme(layer: string): { dark: boolean; width: string } {
  // Prefix runs like `dark:md:` or `md:dark:` carry a width floor
  // plus the dark marker; either order means the same rule.
  const dark = layer.includes('dark:');
  return { dark, width: layer.replaceAll('dark:', '') };
}

function layerRank(layer: string): number {
  const { dark, width } = splitScheme(layer);
  const rank = LAYER_RANK[width] ?? -1;
  if (rank === -1) return -1;
  return dark ? rank + DARK_RANK_BONUS : rank;
}

function layerAppliesAt(
  layer: string,
  point: number,
  scheme: ColorScheme
): boolean {
  const { dark, width } = splitScheme(layer);
  if (dark && scheme !== 'dark') return false;
  if (width === '') return true;
  if (width.startsWith('max-')) {
    return point < (MAX_WIDTH_CEILING[width] ?? 0);
  }
  return point >= (MIN_WIDTH_FLOOR[width] ?? Number.POSITIVE_INFINITY);
}

/**
 * Latest applicable per-layer winner at one evaluation point: the
 * entry from the highest-ranked layer covering that viewport.
 * Callers pre-resolve same-layer conflicts; unknown layers never win.
 */
export function breakpointWinnerAtPoint<T>(
  winners: ReadonlyMap<string, T>,
  point: number,
  scheme: ColorScheme = 'light'
): T | undefined {
  let best: T | undefined;
  let bestRank = -1;
  for (const [layer, winner] of winners) {
    const rank = layerRank(layer);
    if (rank > bestRank && layerAppliesAt(layer, point, scheme)) {
      best = winner;
      bestRank = rank;
    }
  }
  return best;
}

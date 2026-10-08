// Per-breakpoint size and clipping winners. Within one layer,
// same-property size utilities sort naturally (h-20 < h-100,
// verified); size-* writes both axes and sorts before h-*/w-*.
// Used size resolves per constraint kind: a nonzero minimum beats
// any zero, otherwise a zero height/width or zero maximum zeroes
// the axis. Presentational width/height attributes lose to any
// applicable CSS and apply only when no CSS winner covers a point.
import {
  BREAKPOINT_POINT_COUNT,
  breakpointWinnerAtPoint,
} from './review-handoff-breakpoints';
import { compareNaturalOrder } from './review-handoff-utility-order';

const RESPONSIVE_PREFIX_PATTERN = /^(?:max-)?(?:sm|md|lg|xl|2xl):/;
const SIZE_UTILITY_PATTERN = /^(size|max-h|max-w|min-h|min-w|h|w)-(.+)$/;
const OVERFLOW_PATTERN = /^overflow-(?:([xy])-)?(.+)$/;
const ZERO_SIZE_VALUE_PATTERN = /^0([a-z%]+)?$/i;
const CLIP_OVERFLOW_VALUES = new Set(['hidden', 'clip']);

function responsiveUtility(token: string): string | null {
  const match = RESPONSIVE_PREFIX_PATTERN.exec(token);
  return match ? token.slice(match[0].length) : null;
}

function isNonZeroUtilityValue(value: string): boolean {
  // Only an exact zero (bare, arbitrary, or with a unit) keeps the
  // axis zeroed: px, fractions, auto, full, and scale factors all
  // restore it. Unevaluatable values (var()) assume visible.
  const raw = value.replace(/^\[|\]$/g, '');
  return !ZERO_SIZE_VALUE_PATTERN.test(raw);
}

function noteNaturalWinner(
  winners: Map<string, string>,
  layer: string,
  token: string
): void {
  const winner = winners.get(layer);
  if (!winner || compareNaturalOrder(token, winner) > 0) {
    winners.set(layer, token);
  }
}

type SizeLayers = {
  size: Map<string, string>;
  height: Map<string, string>;
  width: Map<string, string>;
  maxHeight: Map<string, string>;
  minHeight: Map<string, string>;
  maxWidth: Map<string, string>;
  minWidth: Map<string, string>;
  clipX: Map<string, string>;
  clipY: Map<string, string>;
};

function emptySizeLayers(): SizeLayers {
  return {
    size: new Map(),
    height: new Map(),
    width: new Map(),
    maxHeight: new Map(),
    minHeight: new Map(),
    maxWidth: new Map(),
    minWidth: new Map(),
    clipX: new Map(),
    clipY: new Map(),
  };
}

function sizeValue(token: string): string {
  return SIZE_UTILITY_PATTERN.exec(token)?.[2] ?? '';
}

function collectSizeLayers(classes: readonly string[]): SizeLayers {
  const layers = emptySizeLayers();
  for (const token of classes) {
    const utility = responsiveUtility(token);
    const bare = utility === null ? token : utility;
    const layer = token.slice(0, token.length - bare.length);
    const size = SIZE_UTILITY_PATTERN.exec(bare);
    if (size !== null) {
      const property = size[1];
      if (property === 'size') noteNaturalWinner(layers.size, layer, bare);
      else if (property === 'h') noteNaturalWinner(layers.height, layer, bare);
      else if (property === 'w') noteNaturalWinner(layers.width, layer, bare);
      else if (property === 'max-h')
        noteNaturalWinner(layers.maxHeight, layer, bare);
      else if (property === 'min-h')
        noteNaturalWinner(layers.minHeight, layer, bare);
      else if (property === 'max-w')
        noteNaturalWinner(layers.maxWidth, layer, bare);
      else noteNaturalWinner(layers.minWidth, layer, bare);
      continue;
    }
    const overflow = OVERFLOW_PATTERN.exec(bare);
    if (overflow !== null) {
      // Bare overflow-* writes both axes; x-/y- write one. All sort
      // naturally together (verified).
      if (overflow[1] !== 'y') noteNaturalWinner(layers.clipX, layer, bare);
      if (overflow[1] !== 'x') noteNaturalWinner(layers.clipY, layer, bare);
    }
  }
  return layers;
}

function mergedAxis(
  layers: SizeLayers,
  axis: 'height' | 'width'
): Map<string, string> {
  // size-* sorts before h-*/w-*, so the axis winner beats a
  // same-layer size value on its own axis.
  const axisLayers = axis === 'height' ? layers.height : layers.width;
  const merged = new Map(layers.size);
  for (const [layer, winner] of axisLayers) merged.set(layer, winner);
  return merged;
}

function winnerIsZero(
  winners: ReadonlyMap<string, string>,
  point: number
): boolean {
  const winner = breakpointWinnerAtPoint(winners, point);
  return winner !== undefined && !isNonZeroUtilityValue(sizeValue(winner));
}

function axisZeroAt(
  layers: SizeLayers,
  point: number,
  axis: 'height' | 'width'
): boolean {
  const minLayers = axis === 'height' ? layers.minHeight : layers.minWidth;
  const minWinner = breakpointWinnerAtPoint(minLayers, point);
  if (minWinner !== undefined && isNonZeroUtilityValue(sizeValue(minWinner))) {
    return false;
  }
  if (winnerIsZero(mergedAxis(layers, axis), point)) return true;
  const maxLayers = axis === 'height' ? layers.maxHeight : layers.maxWidth;
  return winnerIsZero(maxLayers, point);
}

function clipsAt(layers: SizeLayers, point: number, axis: 'x' | 'y'): boolean {
  const clipLayers = axis === 'x' ? layers.clipX : layers.clipY;
  const winner = breakpointWinnerAtPoint(clipLayers, point);
  if (winner === undefined) return false;
  const value = OVERFLOW_PATTERN.exec(winner)?.[2] ?? '';
  return CLIP_OVERFLOW_VALUES.has(value);
}

export function sizeMarkers(classes: readonly string[]): {
  heightZeroAt: boolean[];
  widthZeroAt: boolean[];
  clipsXAt: boolean[];
  clipsYAt: boolean[];
} {
  const layers = collectSizeLayers(classes);
  const heightZeroAt: boolean[] = [];
  const widthZeroAt: boolean[] = [];
  const clipsXAt: boolean[] = [];
  const clipsYAt: boolean[] = [];
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    heightZeroAt.push(axisZeroAt(layers, point, 'height'));
    widthZeroAt.push(axisZeroAt(layers, point, 'width'));
    clipsXAt.push(clipsAt(layers, point, 'x'));
    clipsYAt.push(clipsAt(layers, point, 'y'));
  }
  return { heightZeroAt, widthZeroAt, clipsXAt, clipsYAt };
}

export function imageSizeZeroAt(
  classes: readonly string[],
  widthAttrZero: boolean,
  heightAttrZero: boolean
): boolean[] {
  // Images hide on a zeroed axis alone (replaced content conforms
  // instead of overflowing). Author CSS beats presentational hints,
  // so zero attributes apply only where no CSS winner covers them.
  const layers = collectSizeLayers(classes);
  const heightAxis = mergedAxis(layers, 'height');
  const widthAxis = mergedAxis(layers, 'width');
  const zeroAt: boolean[] = [];
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    const heightWinner = breakpointWinnerAtPoint(heightAxis, point);
    const widthWinner = breakpointWinnerAtPoint(widthAxis, point);
    const heightZero =
      heightWinner === undefined
        ? heightAttrZero
        : !isNonZeroUtilityValue(sizeValue(heightWinner));
    const widthZero =
      widthWinner === undefined
        ? widthAttrZero
        : !isNonZeroUtilityValue(sizeValue(widthWinner));
    const heightCapped = heightZero || winnerIsZero(layers.maxHeight, point);
    const widthCapped = widthZero || winnerIsZero(layers.maxWidth, point);
    const minHeight = breakpointWinnerAtPoint(layers.minHeight, point);
    const minWidth = breakpointWinnerAtPoint(layers.minWidth, point);
    const heightFloored =
      minHeight !== undefined && isNonZeroUtilityValue(sizeValue(minHeight));
    const widthFloored =
      minWidth !== undefined && isNonZeroUtilityValue(sizeValue(minWidth));
    zeroAt.push(
      (heightCapped && !heightFloored) || (widthCapped && !widthFloored)
    );
  }
  return zeroAt;
}

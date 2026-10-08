// Viewport dimension features accept lengths; the used value is never
// negative, so an exact or max comparison against a negative length
// never matches while a min comparison against one always matches.
const MEDIA_LENGTH_PATTERN = /^(-?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*([a-z%]*)$/i;
function parseMediaLength(value: string): number | null {
  // calc(), keywords, and unitless nonzero lengths are unevaluatable
  // here and stay applicable; unitless zero is a valid zero.
  const match = MEDIA_LENGTH_PATTERN.exec(value.trim());
  if (!match) return null;
  if (match[2] === '' && Number(match[1]) !== 0) return null;
  return Number(match[1]);
}

type MediaBound =
  | { kind: 'lower'; value: number; inclusive: boolean }
  | { kind: 'upper'; value: number; inclusive: boolean };

function reverseOperator(operator: string): string {
  if (operator === '<') return '>';
  if (operator === '<=') return '>=';
  if (operator === '>') return '<';
  if (operator === '>=') return '<=';
  return operator;
}

function comparisonBound(
  value: number,
  operator: string,
  featureOnLeft: boolean
): MediaBound | null {
  // Normalize `100px < width` and `width > 100px` to the same bound.
  const flipped = featureOnLeft ? operator : reverseOperator(operator);
  if (flipped === '<' || flipped === '<=') {
    return { kind: 'upper', value, inclusive: flipped === '<=' };
  }
  if (flipped === '>' || flipped === '>=') {
    return { kind: 'lower', value, inclusive: flipped === '>=' };
  }
  return null;
}

type MediaComparison = {
  value: number | null;
  operator: string;
  featureOnLeft: boolean;
};

function evaluateDimensionBounds(
  comparisons: MediaComparison[]
): 'false' | 'true' | 'other' {
  const bounds: MediaBound[] = [];
  for (const { value, operator, featureOnLeft } of comparisons) {
    if (value === null) return 'other';
    if (operator === '=') {
      bounds.push(
        { kind: 'lower', value, inclusive: true },
        { kind: 'upper', value, inclusive: true }
      );
      continue;
    }
    const bound = comparisonBound(value, operator, featureOnLeft);
    if (!bound) return 'other';
    bounds.push(bound);
  }
  // The most restrictive bound per side wins; ties prefer exclusive.
  const effective = (kind: 'lower' | 'upper'): MediaBound | null => {
    let best: MediaBound | null = null;
    for (const bound of bounds) {
      if (bound.kind !== kind) continue;
      if (!best) {
        best = bound;
        continue;
      }
      if (bound.value === best.value) {
        if (!bound.inclusive) best = bound;
        continue;
      }
      const tighter =
        kind === 'lower' ? bound.value > best.value : bound.value < best.value;
      if (tighter) best = bound;
    }
    return best;
  };
  const lower = effective('lower');
  const upper = effective('upper');
  if (lower && upper) {
    if (lower.value !== upper.value) {
      if (lower.value > upper.value) return 'false';
    } else if (!lower.inclusive || !upper.inclusive) {
      return 'false';
    }
  }
  // An upper bound below zero (or an exclusive zero) excludes every
  // nonnegative dimension; a lower bound at or below zero with no
  // upper bound always matches.
  if (upper && (upper.value < 0 || (upper.value === 0 && !upper.inclusive))) {
    return 'false';
  }
  if (!upper && lower) {
    if (lower.value < 0) return 'true';
    if (lower.value === 0) return lower.inclusive ? 'true' : 'other';
  }
  return 'other';
}

const MEDIA_COLON_PATTERN =
  /^(min-|max-)?(width|height|device-width|device-height)\s*:\s*(.+)$/i;
const MEDIA_RANGE_TWO_SIDED_PATTERN =
  /^(.+?)\s*(<=|>=|<|>|=)\s*(width|height|device-width|device-height)\s*(<=|>=|<|>|=)\s*(.+)$/i;
const MEDIA_RANGE_LEFT_PATTERN =
  /^(.+?)\s*(<=|>=|<|>|=)\s*(width|height|device-width|device-height)$/i;
const MEDIA_RANGE_RIGHT_PATTERN =
  /^(width|height|device-width|device-height)\s*(<=|>=|<|>|=)\s*(.+)$/i;

export function evaluateDimensionAtom(
  condition: string
): 'false' | 'true' | 'other' {
  const colon = MEDIA_COLON_PATTERN.exec(condition);
  if (colon) {
    const value = parseMediaLength(colon[3]);
    if (value === null) return 'other';
    if (colon[1]?.toLowerCase() === 'min-') {
      return value <= 0 ? 'true' : 'other';
    }
    return value < 0 ? 'false' : 'other';
  }
  const twoSided = MEDIA_RANGE_TWO_SIDED_PATTERN.exec(condition);
  if (twoSided) {
    return evaluateDimensionBounds([
      {
        value: parseMediaLength(twoSided[1]),
        operator: twoSided[2],
        featureOnLeft: false,
      },
      {
        value: parseMediaLength(twoSided[5]),
        operator: twoSided[4],
        featureOnLeft: true,
      },
    ]);
  }
  const left = MEDIA_RANGE_LEFT_PATTERN.exec(condition);
  if (left) {
    return evaluateDimensionBounds([
      {
        value: parseMediaLength(left[1]),
        operator: left[2],
        featureOnLeft: false,
      },
    ]);
  }
  const right = MEDIA_RANGE_RIGHT_PATTERN.exec(condition);
  if (right) {
    return evaluateDimensionBounds([
      {
        value: parseMediaLength(right[3]),
        operator: right[2],
        featureOnLeft: true,
      },
    ]);
  }
  return 'other';
}

// Per-breakpoint winning scale per axis. Within one layer, base
// scale conflicts resolve by generated cascade order (Tailwind
// v4.3.1 compiled output, verified): bare numerics < axis numerics
// < axis numeric arbitraries per axis, a bare scale-[...] sets a
// static scale after every var rule, and scale-none sets scale: none
// last. Negatives sort numerically; unevaluatable values assume
// visible. Across layers the rank-latest applicable winner decides:
// statics and none set the scale property itself, while each axis
// variable falls through to the rank-latest layer writing it.
import {
  BREAKPOINT_POINT_COUNT,
  breakpointWinnerAtPoint,
  type ColorScheme,
} from './review-handoff-breakpoints';
import { splitImportantClasses } from './review-handoff-important';

const RESPONSIVE_PREFIX_PATTERN = /^(?:(?:max-)?(?:sm|md|lg|xl|2xl):|dark:)+/;
const SCALE_UTILITY_PATTERN = /^(scale-x|scale-y|scale)-(.+)$/;
const BASE_SCALE_INTEGER_PATTERN = /^\d+$/;
const SCALE_ARBITRARY_PATTERN = /^\[(.*)\]$/;

function responsiveUtility(token: string): string | null {
  const match = RESPONSIVE_PREFIX_PATTERN.exec(token);
  return match ? token.slice(match[0].length) : null;
}

function scaleArbitraryNumber(value: string): number | null {
  const inner = SCALE_ARBITRARY_PATTERN.exec(value)?.[1].replace(/%$/, '');
  if (inner === undefined || !/^-?\d+(\.\d+)?$/.test(inner)) return null;
  return Number(inner);
}

type AxisWinner = { group: number; value: number };

function noteAxisScale(winner: AxisWinner, group: number, value: number): void {
  if (
    group > winner.group ||
    (group === winner.group && value > winner.value)
  ) {
    winner.group = group;
    winner.value = value;
  }
}

type ScaleLayer = {
  declares: boolean;
  none: boolean;
  statics: number[];
  staticUnknown: boolean;
  xWinner: AxisWinner;
  yWinner: AxisWinner;
  xUnknown: boolean;
  yUnknown: boolean;
};

function emptyScaleLayer(): ScaleLayer {
  return {
    declares: false,
    none: false,
    statics: [],
    staticUnknown: false,
    xWinner: { group: -1, value: 0 },
    yWinner: { group: -1, value: 0 },
    xUnknown: false,
    yUnknown: false,
  };
}

function noteScaleToken(winner: ScaleLayer, token: string): void {
  if (token === 'scale-none') {
    winner.declares = true;
    winner.none = true;
    return;
  }
  if (token === 'scale-3d') {
    // Declares a three-variable scale without writing any variable.
    winner.declares = true;
    return;
  }
  const negated = token.startsWith('-');
  const scaleToken = negated ? token.slice(1) : token;
  const scale = SCALE_UTILITY_PATTERN.exec(scaleToken);
  if (scale === null) return;
  if (negated && !BASE_SCALE_INTEGER_PATTERN.test(scale[2])) return;
  const property = scale[1];
  const rawValue = scale[2];
  const affectsX = property === 'scale-x' || property === 'scale';
  if (property === 'scale' && rawValue.startsWith('[')) {
    winner.declares = true;
    const staticValue = scaleArbitraryNumber(rawValue);
    if (staticValue === null) winner.staticUnknown = true;
    else winner.statics.push(staticValue);
    return;
  }
  if (BASE_SCALE_INTEGER_PATTERN.test(rawValue)) {
    winner.declares = true;
    const value = (negated ? -1 : 1) * Number(rawValue);
    if (property === 'scale') {
      noteAxisScale(winner.xWinner, 0, value);
      noteAxisScale(winner.yWinner, 0, value);
    } else if (affectsX) {
      noteAxisScale(winner.xWinner, 1, value);
    } else {
      noteAxisScale(winner.yWinner, 1, value);
    }
    return;
  }
  if (!rawValue.startsWith('[')) return;
  // Anything else (scale-foo) generates no rule.
  winner.declares = true;
  const axisValue = scaleArbitraryNumber(rawValue);
  if (axisValue === null) {
    if (affectsX) winner.xUnknown = true;
    else winner.yUnknown = true;
  } else if (affectsX) {
    noteAxisScale(winner.xWinner, 2, axisValue);
  } else {
    noteAxisScale(winner.yWinner, 2, axisValue);
  }
}

type AxisWriter = { value: number } | { unknown: true };

function axisWriterAt(
  winners: ReadonlyMap<string, ScaleLayer>,
  point: number,
  axis: 'x' | 'y',
  scheme: ColorScheme
): AxisWriter | undefined {
  const writers = new Map<string, AxisWriter>();
  for (const [layer, winner] of winners) {
    const unknown = axis === 'x' ? winner.xUnknown : winner.yUnknown;
    if (unknown) writers.set(layer, { unknown: true });
    else {
      const axisWinner = axis === 'x' ? winner.xWinner : winner.yWinner;
      if (axisWinner.group !== -1)
        writers.set(layer, { value: axisWinner.value });
    }
  }
  return breakpointWinnerAtPoint(writers, point, scheme);
}

function axisZeroAt(
  winners: ReadonlyMap<string, ScaleLayer>,
  point: number,
  axis: 'x' | 'y',
  scheme: ColorScheme
): boolean {
  const declared = new Map<string, ScaleLayer>();
  for (const [layer, winner] of winners) {
    if (winner.declares) declared.set(layer, winner);
  }
  const property = breakpointWinnerAtPoint(declared, point, scheme);
  if (property === undefined) return false;
  if (property.none || property.staticUnknown) return false;
  if (property.statics.length > 0) {
    return Math.max(...property.statics) === 0;
  }
  const writer = axisWriterAt(winners, point, axis, scheme);
  if (writer === undefined || 'unknown' in writer) return false;
  return writer.value === 0;
}

function importantAxisZeroAt(
  important: ReadonlyMap<string, ScaleLayer>,
  ordinary: ReadonlyMap<string, ScaleLayer>,
  point: number,
  axis: 'x' | 'y',
  scheme: ColorScheme
): boolean {
  // An important rule's scale declaration beats every ordinary one,
  // so an applicable important declaration sets the property form;
  // each axis variable then resolves important-first, since an
  // important rule still reads ordinary variables it does not write.
  const declared = new Map<string, ScaleLayer>();
  for (const [layer, winner] of important) {
    if (winner.declares) declared.set(layer, winner);
  }
  const property = breakpointWinnerAtPoint(declared, point, scheme);
  if (property === undefined) return axisZeroAt(ordinary, point, axis, scheme);
  if (property.none || property.staticUnknown) return false;
  if (property.statics.length > 0) {
    return Math.max(...property.statics) === 0;
  }
  const writer =
    axisWriterAt(important, point, axis, scheme) ??
    axisWriterAt(ordinary, point, axis, scheme);
  if (writer === undefined || 'unknown' in writer) return false;
  return writer.value === 0;
}

function collectScaleLayers(
  classes: readonly string[]
): Map<string, ScaleLayer> {
  const winners = new Map<string, ScaleLayer>();
  for (const token of classes) {
    const utility = responsiveUtility(token);
    const bare = utility === null ? token : utility;
    const layer = token.slice(0, token.length - bare.length);
    let winner = winners.get(layer);
    if (!winner) {
      winner = emptyScaleLayer();
      winners.set(layer, winner);
    }
    noteScaleToken(winner, bare);
  }
  return winners;
}

export function scaleMarkers(
  classes: readonly string[],
  scheme: ColorScheme = 'light'
): {
  scaleXZeroAt: boolean[];
  scaleYZeroAt: boolean[];
} {
  const tiers = splitImportantClasses(classes);
  const important = collectScaleLayers(tiers.important);
  const ordinary = collectScaleLayers(tiers.ordinary);
  const scaleXZeroAt: boolean[] = [];
  const scaleYZeroAt: boolean[] = [];
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    scaleXZeroAt.push(
      importantAxisZeroAt(important, ordinary, point, 'x', scheme)
    );
    scaleYZeroAt.push(
      importantAxisZeroAt(important, ordinary, point, 'y', scheme)
    );
  }
  return { scaleXZeroAt, scaleYZeroAt };
}

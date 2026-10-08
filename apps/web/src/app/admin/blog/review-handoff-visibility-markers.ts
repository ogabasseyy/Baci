// Per-breakpoint visibility and screen-reader winners. Visible
// beats invisible within a layer (verified order); not-sr-only
// beats sr-only (verified). Across layers the rank-latest
// applicable winner decides each point.
import {
  BREAKPOINT_POINT_COUNT,
  breakpointWinnerAtPoint,
} from './review-handoff-breakpoints';
import { compareNaturalOrder } from './review-handoff-utility-order';

const RESPONSIVE_PREFIX_PATTERN = /^(?:max-)?(?:sm|md|lg|xl|2xl):/;

function responsiveUtility(token: string): string | null {
  const match = RESPONSIVE_PREFIX_PATTERN.exec(token);
  return match ? token.slice(match[0].length) : null;
}

export type VisibilityAtPoint = 'visible' | 'invisible' | null;

export function visibilityMarkers(classes: readonly string[]): {
  visibleAt: VisibilityAtPoint[];
  screenReaderOnlyAt: boolean[];
} {
  const visibleWinners = new Map<string, string>();
  const screenWinners = new Map<string, string>();
  for (const token of classes) {
    const utility = responsiveUtility(token);
    const bare = utility === null ? token : utility;
    const layer = token.slice(0, token.length - bare.length);
    if (bare === 'visible' || bare === 'invisible') {
      const winner = visibleWinners.get(layer);
      if (!winner || compareNaturalOrder(bare, winner) > 0) {
        visibleWinners.set(layer, bare);
      }
    } else if (bare === 'not-sr-only') {
      screenWinners.set(layer, bare);
    } else if (bare === 'sr-only' && !screenWinners.has(layer)) {
      screenWinners.set(layer, bare);
    }
  }
  const visibleAt: VisibilityAtPoint[] = [];
  const screenReaderOnlyAt: boolean[] = [];
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    const visible = breakpointWinnerAtPoint(visibleWinners, point);
    visibleAt.push(
      visible === undefined
        ? null
        : visible === 'visible'
          ? 'visible'
          : 'invisible'
    );
    screenReaderOnlyAt.push(
      breakpointWinnerAtPoint(screenWinners, point) === 'sr-only'
    );
  }
  return { visibleAt, screenReaderOnlyAt };
}

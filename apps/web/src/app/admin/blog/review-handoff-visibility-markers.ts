// Per-breakpoint visibility and screen-reader winners. Visible
// beats invisible within a layer (verified order); not-sr-only
// beats sr-only (verified). Across layers the rank-latest
// applicable winner decides each point. Important declarations
// outrank every ordinary one, so each tier resolves its own winner
// and the important winner decides where it applies.
import {
  BREAKPOINT_POINT_COUNT,
  breakpointWinnerAtPoint,
  type ColorScheme,
} from './review-handoff-breakpoints';
import { splitImportantClasses } from './review-handoff-important';
import { compareNaturalOrder } from './review-handoff-utility-order';

const RESPONSIVE_PREFIX_PATTERN = /^(?:(?:max-)?(?:sm|md|lg|xl|2xl):|dark:)+/;

function responsiveUtility(token: string): string | null {
  const match = RESPONSIVE_PREFIX_PATTERN.exec(token);
  return match ? token.slice(match[0].length) : null;
}

export type VisibilityAtPoint = 'visible' | 'invisible' | null;

type VisibilityTiers = {
  visible: Map<string, string>;
  screen: Map<string, string>;
};

function collectVisibilityWinners(classes: readonly string[]): VisibilityTiers {
  const visible = new Map<string, string>();
  const screen = new Map<string, string>();
  for (const token of classes) {
    const utility = responsiveUtility(token);
    const bare = utility === null ? token : utility;
    const layer = token.slice(0, token.length - bare.length);
    if (bare === 'visible' || bare === 'invisible') {
      const winner = visible.get(layer);
      if (!winner || compareNaturalOrder(bare, winner) > 0) {
        visible.set(layer, bare);
      }
    } else if (bare === 'not-sr-only') {
      screen.set(layer, bare);
    } else if (bare === 'sr-only' && !screen.has(layer)) {
      screen.set(layer, bare);
    }
  }
  return { visible, screen };
}

function tierWinnerAt(
  important: ReadonlyMap<string, string>,
  ordinary: ReadonlyMap<string, string>,
  point: number,
  scheme: ColorScheme
): string | undefined {
  return (
    breakpointWinnerAtPoint(important, point, scheme) ??
    breakpointWinnerAtPoint(ordinary, point, scheme)
  );
}

export function visibilityMarkers(
  classes: readonly string[],
  scheme: ColorScheme = 'light'
): {
  visibleAt: VisibilityAtPoint[];
  screenReaderOnlyAt: boolean[];
} {
  const tiers = splitImportantClasses(classes);
  const important = collectVisibilityWinners(tiers.important);
  const ordinary = collectVisibilityWinners(tiers.ordinary);
  const visibleAt: VisibilityAtPoint[] = [];
  const screenReaderOnlyAt: boolean[] = [];
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    const visible = tierWinnerAt(
      important.visible,
      ordinary.visible,
      point,
      scheme
    );
    visibleAt.push(
      visible === undefined
        ? null
        : visible === 'visible'
          ? 'visible'
          : 'invisible'
    );
    screenReaderOnlyAt.push(
      tierWinnerAt(important.screen, ordinary.screen, point, scheme) ===
        'sr-only'
    );
  }
  return { visibleAt, screenReaderOnlyAt };
}

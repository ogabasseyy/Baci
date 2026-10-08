// Per-breakpoint opacity winners. Within one layer the naturally
// last opacity utility wins (Tailwind v4.3.1 compiled order,
// verified); across layers the rank-latest applicable winner
// decides each point. Unevaluatable values (var(), color-mix)
// assume visible rather than declaring content hidden.
import {
  BREAKPOINT_POINT_COUNT,
  breakpointWinnerAtPoint,
} from './review-handoff-breakpoints';
import { compareNaturalOrder } from './review-handoff-utility-order';

const RESPONSIVE_PREFIX_PATTERN = /^(?:max-)?(?:sm|md|lg|xl|2xl):/;
const OPACITY_UTILITY_PATTERN = /^opacity-(\d+(?:\.\d+)?|\[.+\])$/;

function responsiveUtility(token: string): string | null {
  const match = RESPONSIVE_PREFIX_PATTERN.exec(token);
  return match ? token.slice(match[0].length) : null;
}

function isNonZeroOpacityUtility(utility: string): boolean {
  if (!utility.startsWith('opacity-')) return false;
  const raw = utility
    .slice('opacity-'.length)
    .replace(/^\[|\]$/g, '')
    .replace(/%$/, '');
  const numeric = Number(raw);
  return Number.isNaN(numeric) ? true : numeric !== 0;
}

export function opacityMarkers(classes: readonly string[]): {
  zeroAt: boolean[];
} {
  const winners = new Map<string, string>();
  for (const token of classes) {
    const utility = responsiveUtility(token);
    const bare = utility === null ? token : utility;
    if (!OPACITY_UTILITY_PATTERN.test(bare)) continue;
    const layer = token.slice(0, token.length - bare.length);
    const winner = winners.get(layer);
    if (!winner || compareNaturalOrder(bare, winner) > 0) {
      winners.set(layer, bare);
    }
  }
  const zeroAt: boolean[] = [];
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    const winner = breakpointWinnerAtPoint(winners, point);
    zeroAt.push(winner !== undefined && !isNonZeroOpacityUtility(winner));
  }
  return { zeroAt };
}

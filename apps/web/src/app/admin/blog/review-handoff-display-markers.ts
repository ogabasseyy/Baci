// Per-breakpoint display winners. Within one layer `hidden` beats
// any showing display utility (Tailwind v4.3.1 emits hidden last,
// verified); across layers the rank-latest applicable winner
// decides each point. Elements without display utilities render
// normally and are never display-hidden.
import {
  BREAKPOINT_POINT_COUNT,
  breakpointWinnerAtPoint,
} from './review-handoff-breakpoints';

const RESPONSIVE_PREFIX_PATTERN = /^(?:max-)?(?:sm|md|lg|xl|2xl):/;

// Every Tailwind display utility except `hidden` itself.
const DISPLAY_UTILITIES = new Set([
  'block',
  'inline-block',
  'inline',
  'flow-root',
  'flex',
  'inline-flex',
  'grid',
  'inline-grid',
  'contents',
  'table',
  'inline-table',
  'table-caption',
  'table-cell',
  'table-column',
  'table-column-group',
  'table-footer-group',
  'table-header-group',
  'table-row-group',
  'table-row',
  'list-item',
]);

export function displayMarkers(classes: readonly string[]): {
  hiddenAt: boolean[];
} {
  const winners = new Map<string, 'hidden' | 'shown'>();
  for (const token of classes) {
    const prefix = RESPONSIVE_PREFIX_PATTERN.exec(token)?.[0] ?? '';
    const bare = token.slice(prefix.length);
    if (bare === 'hidden') {
      winners.set(prefix, 'hidden');
    } else if (DISPLAY_UTILITIES.has(bare) && !winners.has(prefix)) {
      winners.set(prefix, 'shown');
    }
  }
  const hiddenAt: boolean[] = [];
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    hiddenAt.push(breakpointWinnerAtPoint(winners, point) === 'hidden');
  }
  return { hiddenAt };
}

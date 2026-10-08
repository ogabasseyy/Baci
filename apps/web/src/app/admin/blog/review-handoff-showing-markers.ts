// Joint per-breakpoint showing markers for one element's class
// list. Readability is existential over viewports: content renders
// when ANY evaluation point shows it, so each hiding channel
// resolves its own winner per point (display, opacity,
// screen-reader collapsing, zero scale, clipped zero size) and the
// terminal verdict is their per-point union. Display, opacity, and
// clipping never escape an affected ancestor (display:none removes
// the subtree, group opacity multiplies down, the sr-only box
// clips descendants), so terminal markers apply same-element only
// in the ancestry walk. Visibility and text color inherit, so their
// per-point markers also act as descendant escapes, like `visible`.
import {
  BREAKPOINT_POINT_COUNT,
  type ColorScheme,
} from './review-handoff-breakpoints';
import { displayMarkers } from './review-handoff-display-markers';
import { stripImportantModifier } from './review-handoff-important';
import { opacityMarkers } from './review-handoff-opacity-markers';
import { scaleMarkers } from './review-handoff-scale-markers';
import { sizeMarkers } from './review-handoff-size-markers';
import { textColorMarkers } from './review-handoff-text-color';
import {
  type VisibilityAtPoint,
  visibilityMarkers,
} from './review-handoff-visibility-markers';

export type { VisibilityAtPoint };
export type ColorAtPoint = 'opaque' | 'transparent' | null;

/**
 * Joint markers for one element's class list: terminalAt hides at a
 * point when any hiding channel wins there (a zeroed axis alone
 * still overflows visibly, so size needs same-axis clipping).
 * visibilityAt and colorAt carry the inherited winners for the
 * ancestry walk: a background clipped to the glyphs renders
 * transparent text like opaque.
 */
export function showingMarkers(
  classes: readonly string[],
  scheme: ColorScheme = 'light'
): {
  terminalAt: boolean[];
  visibilityAt: VisibilityAtPoint[];
  colorAt: ColorAtPoint[];
} {
  const bare = classes.map(stripImportantModifier);
  const display = displayMarkers(bare, scheme);
  const opacity = opacityMarkers(bare, scheme);
  const scale = scaleMarkers(bare, scheme);
  const size = sizeMarkers(bare, scheme);
  const text = textColorMarkers(bare, scheme);
  const visibility = visibilityMarkers(bare, scheme);
  const terminalAt: boolean[] = [];
  const colorAt: ColorAtPoint[] = [];
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    terminalAt.push(
      display.hiddenAt[point] ||
        opacity.zeroAt[point] ||
        visibility.screenReaderOnlyAt[point] ||
        scale.scaleXZeroAt[point] ||
        scale.scaleYZeroAt[point] ||
        (size.heightZeroAt[point] && size.clipsYAt[point]) ||
        (size.widthZeroAt[point] && size.clipsXAt[point])
    );
    colorAt.push(
      text.opaqueAt[point] || text.clippedAt[point]
        ? 'opaque'
        : text.transparentAt[point]
          ? 'transparent'
          : null
    );
  }
  return { terminalAt, visibilityAt: visibility.visibleAt, colorAt };
}

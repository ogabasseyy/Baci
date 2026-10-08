// Markers for class lists that render despite hiding utilities.
// Readability is existential over viewports: `hidden md:block`
// renders on medium screens and up, so a hiding utility paired with
// a same-element responsive override is not universally hidden.
// Display, opacity, and screen-reader hiding never escape an
// affected ancestor (display:none removes the subtree, group opacity
// multiplies down, the sr-only box clips descendants), so those
// overrides apply same-element only. Visibility and text color
// inherit, so their showing markers also act as descendant escapes,
// like `visible`.
import { textColorMarkers } from './review-handoff-text-color';

const RESPONSIVE_PREFIX_PATTERN = /^(?:max-)?(?:sm|md|lg|xl|2xl):/;

// Every Tailwind display utility except `hidden` itself: any of these
// at a breakpoint restores rendering for a `hidden` element there.
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

const SIZE_UTILITY_PATTERN = /^(size|max-h|max-w|min-h|min-w|h|w)-(.+)$/;
const SCALE_UTILITY_PATTERN = /^(scale-x|scale-y|scale)-(.+)$/;
const ZERO_SIZE_VALUE_PATTERN = /^0([a-z%]+)?$/i;

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

const OPACITY_UTILITY_PATTERN = /^opacity-(\d+(?:\.\d+)?|\[.+\])$/;

function isNonZeroOpacityUtility(utility: string): boolean {
  if (!utility.startsWith('opacity-')) return false;
  const raw = utility
    .slice('opacity-'.length)
    .replace(/^\[|\]$/g, '')
    .replace(/%$/, '');
  const numeric = Number(raw);
  // Arbitrary values (var(), color-mix) cannot be evaluated: assume
  // visible rather than declaring content hidden.
  return Number.isNaN(numeric) ? true : numeric !== 0;
}

/**
 * Showing markers for one element's class list: display, opacity, and
 * screen-reader restoration (same-element overrides only) plus
 * visibility (inherited, so also a descendant escape). Text color
 * markers come from ./review-handoff-text-color. Size restoration is
 * tracked per constraint kind: used height is
 * min(max(h, min-h), max-h), so max-h-0 still caps after md:h-auto.
 * Base (non-responsive) size utilities restore zero width/height
 * ATTRIBUTES only: author rules unconditionally override
 * presentational hints, while utility-vs-utility conflicts depend on
 * stylesheet order, so class-token zeros still need a responsive
 * override. A base max cap restores nothing: it cannot raise a zero.
 * Zero-scale transforms collapse all painted pixels on their axis
 * (no clipping needed: the transform scales overflow too), so a
 * zeroed axis hides unless a responsive scale restores it.
 */
export function showingMarkers(classes: readonly string[]): {
  display: boolean;
  visible: boolean;
  opacity: boolean;
  notSrOnly: boolean;
  opaqueColor: boolean;
  transparentColor: boolean;
  clippedBackground: boolean;
  heightRestored: boolean;
  maxHeightRestored: boolean;
  widthRestored: boolean;
  maxWidthRestored: boolean;
  baseHeightRestored: boolean;
  baseWidthRestored: boolean;
  scaleXZero: boolean;
  scaleYZero: boolean;
  scaleXRestored: boolean;
  scaleYRestored: boolean;
} {
  let visible = false;
  let notSrOnly = false;
  let heightRestored = false;
  let maxHeightRestored = false;
  let widthRestored = false;
  let maxWidthRestored = false;
  let baseHeightRestored = false;
  let baseWidthRestored = false;
  let scaleXZero = false;
  let scaleYZero = false;
  let scaleXRestored = false;
  let scaleYRestored = false;
  // Display resolves per breakpoint: Tailwind emits `hidden` after the
  // showing display utilities, so `md:hidden` beats `md:block` at md
  // while other breakpoints decide independently.
  const displayShowing = new Set<string>();
  const displayHidden = new Set<string>();
  const textColor = textColorMarkers(classes);
  // Opacity resolves per layer like colors: the alphabetically last
  // opacity utility wins (Tailwind v4.3.1 compiled order), and any
  // nonzero winner shows the element at its layer or below.
  const opacityWinners = new Map<string, string>();
  for (const token of classes) {
    const utility = responsiveUtility(token);
    if (utility !== null) {
      const breakpoint = token.slice(0, token.length - utility.length);
      if (DISPLAY_UTILITIES.has(utility)) displayShowing.add(breakpoint);
      else if (utility === 'hidden') displayHidden.add(breakpoint);
    }
    if (token === 'visible' || utility === 'visible') visible = true;
    const opacityTarget = utility === null ? token : utility;
    if (OPACITY_UTILITY_PATTERN.test(opacityTarget)) {
      const layer = token.slice(0, token.length - opacityTarget.length);
      const winner = opacityWinners.get(layer);
      if (!winner || opacityTarget > winner) {
        opacityWinners.set(layer, opacityTarget);
      }
    }
    if (token === 'not-sr-only' || utility === 'not-sr-only') notSrOnly = true;
    const sizeTarget = utility === null ? token : utility;
    const size = SIZE_UTILITY_PATTERN.exec(sizeTarget);
    if (size !== null && isNonZeroUtilityValue(size[2])) {
      const property = size[1];
      const restoresHeight =
        property === 'h' || property === 'size' || property === 'min-h';
      const restoresWidth =
        property === 'w' || property === 'size' || property === 'min-w';
      // A nonzero minimum beats a zero maximum at any layer: min and
      // max are different properties, so constraint resolution (not
      // cascade order) lets the minimum win.
      if (utility === null) {
        if (restoresHeight) baseHeightRestored = true;
        if (restoresWidth) baseWidthRestored = true;
        if (property === 'min-h') maxHeightRestored = true;
        if (property === 'min-w') maxWidthRestored = true;
      } else {
        if (restoresHeight) heightRestored = true;
        if (property === 'max-h' || property === 'min-h') {
          maxHeightRestored = true;
        }
        if (restoresWidth) widthRestored = true;
        if (property === 'max-w' || property === 'min-w') {
          maxWidthRestored = true;
        }
      }
    }
    if (utility !== null && utility === 'scale-none') {
      scaleXRestored = true;
      scaleYRestored = true;
    }
    const scaleTarget = utility === null ? token : utility;
    const scale = SCALE_UTILITY_PATTERN.exec(scaleTarget);
    if (scale !== null) {
      const property = scale[1];
      const affectsX = property === 'scale-x' || property === 'scale';
      const affectsY = property === 'scale-y' || property === 'scale';
      if (utility === null) {
        // A base scale-none does not restore a base zero: same-layer
        // utility order is unproven, like size tokens.
        if (!isNonZeroUtilityValue(scale[2])) {
          if (affectsX) scaleXZero = true;
          if (affectsY) scaleYZero = true;
        }
      } else if (isNonZeroUtilityValue(scale[2])) {
        if (affectsX) scaleXRestored = true;
        if (affectsY) scaleYRestored = true;
      }
    }
  }
  const display = [...displayShowing].some(
    (breakpoint) => !displayHidden.has(breakpoint)
  );
  const opacity = [...opacityWinners.values()].some(isNonZeroOpacityUtility);
  return {
    display,
    visible,
    opacity,
    notSrOnly,
    opaqueColor: textColor.opaqueColor,
    transparentColor: textColor.transparentColor,
    clippedBackground: textColor.clippedBackground,
    heightRestored,
    maxHeightRestored,
    widthRestored,
    maxWidthRestored,
    baseHeightRestored,
    baseWidthRestored,
    scaleXZero,
    scaleYZero,
    scaleXRestored,
    scaleYRestored,
  };
}

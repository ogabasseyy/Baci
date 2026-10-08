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

// Concrete Tailwind v4 palette colors. text-current and text-inherit
// pass the ancestor color through, and font-size or alignment
// utilities (text-sm, text-center) set no color at all.
const TEXT_COLOR_PATTERN =
  /^text-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/;

// Nontransparent theme color utilities: the shadcn palette from
// tailwind.config.mjs plus the storefront tokens from the globals.css
// @theme inline block. All resolve to solid colors (alpha comes only
// from slash modifiers, handled below), so any of them overrides
// inherited transparency. Keep in sync when the theme gains colors.
const SEMANTIC_TEXT_COLOR_NAMES = new Set([
  'foreground',
  'background',
  'border',
  'input',
  'ring',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'destructive',
  'destructive-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'popover',
  'popover-foreground',
  'card',
  'card-foreground',
  'store-primary',
  'store-primary-text',
  'store-on-primary',
  'store-secondary',
  'store-secondary-text',
  'store-accent',
  'store-accent-text',
  'store-background',
  'store-background-text',
  'store-foreground',
  'store-border',
  'store-rating',
  'store-option-secondary',
]);

function isThemeTextColor(color: string): boolean {
  return (
    color.startsWith('text-') &&
    SEMANTIC_TEXT_COLOR_NAMES.has(color.slice('text-'.length))
  );
}

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

function isNonZeroOpacityUtility(utility: string): boolean {
  if (!utility.startsWith('opacity-')) return false;
  const raw = utility.slice('opacity-'.length).replace(/^\[|\]$/g, '');
  const numeric = Number(raw);
  // Arbitrary values (var(), color-mix) cannot be evaluated: assume
  // visible rather than declaring content hidden.
  return Number.isNaN(numeric) ? true : numeric !== 0;
}

function isOpaqueColorUtility(utility: string): boolean {
  const modifierIndex = utility.lastIndexOf('/');
  const color =
    modifierIndex === -1 ? utility : utility.slice(0, modifierIndex);
  if (!TEXT_COLOR_PATTERN.test(color) && !isThemeTextColor(color)) {
    return false;
  }
  if (modifierIndex === -1) return true;
  // A zero-alpha modifier (text-black/0) renders no pixels: it is not
  // an opaque override. Arbitrary alphas cannot be evaluated, so
  // assume visible rather than declaring content hidden.
  const raw = utility
    .slice(modifierIndex + 1)
    .replace(/^\[|\]$/g, '')
    .replace(/%$/, '');
  const numeric = Number(raw);
  return Number.isNaN(numeric) ? true : numeric !== 0;
}

type TextColorKind = 'opaque' | 'transparent' | 'passthrough';

function textColorKind(utility: string): TextColorKind | null {
  // Non-colors (font-size, alignment, unknown text-*) return null;
  // current/inherit pass the ancestor through.
  const slash = utility.lastIndexOf('/');
  const color = slash === -1 ? utility : utility.slice(0, slash);
  if (color === 'text-transparent') return 'transparent';
  if (color === 'text-current' || color === 'text-inherit')
    return 'passthrough';
  if (!TEXT_COLOR_PATTERN.test(color) && !isThemeTextColor(color)) return null;
  return isOpaqueColorUtility(utility) ? 'opaque' : 'transparent';
}

/**
 * Showing markers for one element's class list: display, opacity, and
 * screen-reader restoration (same-element overrides only) plus
 * visibility and text color (inherited, so also descendant escapes).
 * Conflicting colors resolve per layer (alphabetically last wins per
 * Tailwind v4.3.1 compiled order); responsive layers ascend. Size
 * restoration is tracked per constraint kind: used height is
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
  let opacity = false;
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
  const colorWinners = new Map<
    string,
    { token: string; kind: TextColorKind }
  >();
  for (const token of classes) {
    const utility = responsiveUtility(token);
    if (utility !== null) {
      const breakpoint = token.slice(0, token.length - utility.length);
      if (DISPLAY_UTILITIES.has(utility)) displayShowing.add(breakpoint);
      else if (utility === 'hidden') displayHidden.add(breakpoint);
    }
    if (token === 'visible' || utility === 'visible') visible = true;
    if (utility !== null && isNonZeroOpacityUtility(utility)) opacity = true;
    if (token === 'not-sr-only' || utility === 'not-sr-only') notSrOnly = true;
    const colorUtility = utility === null ? token : utility;
    const colorKind = textColorKind(colorUtility);
    if (colorKind !== null) {
      const layer = token.slice(0, token.length - colorUtility.length);
      const winner = colorWinners.get(layer);
      if (!winner || colorUtility > winner.token)
        colorWinners.set(layer, { token: colorUtility, kind: colorKind });
    }
    const sizeTarget = utility === null ? token : utility;
    const size = SIZE_UTILITY_PATTERN.exec(sizeTarget);
    if (size !== null && isNonZeroUtilityValue(size[2])) {
      const property = size[1];
      const restoresHeight =
        property === 'h' || property === 'size' || property === 'min-h';
      const restoresWidth =
        property === 'w' || property === 'size' || property === 'min-w';
      if (utility === null) {
        if (restoresHeight) baseHeightRestored = true;
        if (restoresWidth) baseWidthRestored = true;
      } else {
        if (restoresHeight) heightRestored = true;
        if (property === 'max-h') maxHeightRestored = true;
        if (restoresWidth) widthRestored = true;
        if (property === 'max-w') maxWidthRestored = true;
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
  // An opaque winner anywhere renders at its layer; transparency needs
  // a transparent base winner with transparent-or-absent winners above.
  const opaqueColor = [...colorWinners.values()].some(
    (winner) => winner.kind === 'opaque'
  );
  const transparentColor =
    colorWinners.get('')?.kind === 'transparent' &&
    [...colorWinners].every(
      ([layer, winner]) => layer === '' || winner.kind === 'transparent'
    );
  return {
    display,
    visible,
    opacity,
    notSrOnly,
    opaqueColor,
    transparentColor,
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

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

const RESPONSIVE_SIZE_PATTERN = /^(size|max-h|max-w|min-h|min-w|h|w)-(.+)$/;
const ZERO_SIZE_VALUE_PATTERN = /^0([a-z%]+)?$/i;

function responsiveUtility(token: string): string | null {
  const match = RESPONSIVE_PREFIX_PATTERN.exec(token);
  return match ? token.slice(match[0].length) : null;
}

function isNonZeroSizeValue(value: string): boolean {
  // Only an exact zero (bare, arbitrary, or with a unit) keeps the
  // axis zeroed: px, fractions, auto, and full all restore it.
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
  if (!TEXT_COLOR_PATTERN.test(color)) return false;
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

function isOpaqueTextColor(token: string): boolean {
  if (isOpaqueColorUtility(token)) return true;
  const utility = responsiveUtility(token);
  return utility !== null && isOpaqueColorUtility(utility);
}

/**
 * Showing markers for one element's class list: display, opacity, and
 * screen-reader restoration (same-element overrides only) plus
 * visibility and opaque text color (inherited, so also descendant
 * escapes). Exact tokens and responsive variants both count. Size
 * restoration is tracked per constraint kind: used height is
 * min(max(h, min-h), max-h), so max-h-0 still caps after md:h-auto.
 */
export function showingMarkers(classes: readonly string[]): {
  display: boolean;
  visible: boolean;
  opacity: boolean;
  notSrOnly: boolean;
  opaqueColor: boolean;
  heightRestored: boolean;
  maxHeightRestored: boolean;
  widthRestored: boolean;
  maxWidthRestored: boolean;
} {
  let display = false;
  let visible = false;
  let opacity = false;
  let notSrOnly = false;
  let opaqueColor = false;
  let heightRestored = false;
  let maxHeightRestored = false;
  let widthRestored = false;
  let maxWidthRestored = false;
  for (const token of classes) {
    const utility = responsiveUtility(token);
    if (utility !== null && DISPLAY_UTILITIES.has(utility)) display = true;
    if (token === 'visible' || utility === 'visible') visible = true;
    if (utility !== null && isNonZeroOpacityUtility(utility)) opacity = true;
    if (token === 'not-sr-only' || utility === 'not-sr-only') notSrOnly = true;
    if (isOpaqueTextColor(token)) opaqueColor = true;
    const size =
      utility === null ? null : RESPONSIVE_SIZE_PATTERN.exec(utility);
    if (size !== null && isNonZeroSizeValue(size[2])) {
      const property = size[1];
      if (property === 'h' || property === 'size' || property === 'min-h') {
        heightRestored = true;
      }
      if (property === 'max-h') maxHeightRestored = true;
      if (property === 'w' || property === 'size' || property === 'min-w') {
        widthRestored = true;
      }
      if (property === 'max-w') maxWidthRestored = true;
    }
  }
  return {
    display,
    visible,
    opacity,
    notSrOnly,
    opaqueColor,
    heightRestored,
    maxHeightRestored,
    widthRestored,
    maxWidthRestored,
  };
}

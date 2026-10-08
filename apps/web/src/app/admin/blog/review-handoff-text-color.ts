// Text color and clipped-background markers for one element's class
// list. Conflicting colors resolve per layer: within a layer the
// alphabetically last color utility wins (Tailwind v4.3.1 compiled
// order, verified against the app theme), and responsive layers
// ascend above base. Transparent text stays readable when a painted
// background is clipped to the glyphs (bg-clip-text): any clip layer
// plus any paint layer counts, an existential approximation matching
// the viewport handling elsewhere. A bare
// gradient utility paints nothing (unset stops default to
// transparent), so gradients need a from/via/to stop to count.

const RESPONSIVE_PREFIX_PATTERN = /^(?:max-)?(?:sm|md|lg|xl|2xl):/;

function responsiveUtility(token: string): string | null {
  const match = RESPONSIVE_PREFIX_PATTERN.exec(token);
  return match ? token.slice(match[0].length) : null;
}

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

const BACKGROUND_COLOR_PATTERN =
  /^bg-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/;
const BACKGROUND_GRADIENT_PATTERN = /^bg-(?:linear|radial|conic|gradient)-/;
const GRADIENT_STOP_PATTERN = /^(from|via|to)-/;

function isThemeBackgroundColor(color: string): boolean {
  return (
    color.startsWith('bg-') &&
    SEMANTIC_TEXT_COLOR_NAMES.has(color.slice('bg-'.length))
  );
}

function splitUtilityModifier(utility: string): [string, string | null] {
  // Only a slash outside brackets separates an alpha modifier:
  // bg-[url(/a.png)] has no modifier while bg-[url(/a.png)]/50 does.
  let depth = 0;
  let split = -1;
  for (let index = 0; index < utility.length; index += 1) {
    const char = utility[index];
    if (char === '[') depth += 1;
    else if (char === ']') depth = Math.max(0, depth - 1);
    else if (char === '/' && depth === 0) split = index;
  }
  if (split === -1) return [utility, null];
  return [utility.slice(0, split), utility.slice(split + 1)];
}

function backgroundPaint(utility: string): 'solid' | 'gradient' | null {
  // Only painted backgrounds show through clipped glyphs: transparent,
  // none, current (resolving to the transparent text color), and
  // inherit (transparent unless an ancestor paints) do not. Arbitrary
  // backgrounds are assumed to paint unless transparent or none.
  if (BACKGROUND_GRADIENT_PATTERN.test(utility)) return 'gradient';
  const [base, modifier] = splitUtilityModifier(utility);
  let solid = false;
  if (base.startsWith('bg-[') && base.endsWith(']')) {
    const raw = base.slice('bg-['.length, -1);
    solid = raw !== 'transparent' && raw !== 'none';
  } else if (
    BACKGROUND_COLOR_PATTERN.test(base) ||
    isThemeBackgroundColor(base)
  ) {
    solid = true;
  }
  if (!solid) return null;
  if (modifier === null) return 'solid';
  const alpha = modifier.replace(/^\[|\]$/g, '').replace(/%$/, '');
  const numeric = Number(alpha);
  if (!Number.isNaN(numeric) && numeric === 0) return null;
  return 'solid';
}

/**
 * Text color markers for one element's class list: an opaque winner
 * anywhere renders at its layer, while transparency needs a
 * transparent base winner with transparent-or-absent winners above.
 * clippedBackground reports a bg-clip-text paired with an effective
 * background, which renders transparent glyphs without an opaque
 * color utility.
 */
export function textColorMarkers(classes: readonly string[]): {
  opaqueColor: boolean;
  transparentColor: boolean;
  clippedBackground: boolean;
} {
  const colorWinners = new Map<
    string,
    { token: string; kind: TextColorKind }
  >();
  const clipLayers = new Set<string>();
  const paintLayers = new Set<string>();
  const gradientLayers = new Set<string>();
  let hasGradientStops = false;
  for (const token of classes) {
    const utility = responsiveUtility(token);
    const bare = utility === null ? token : utility;
    const layer = token.slice(0, token.length - bare.length);
    const colorKind = textColorKind(bare);
    if (colorKind !== null) {
      const winner = colorWinners.get(layer);
      if (!winner || bare > winner.token)
        colorWinners.set(layer, { token: bare, kind: colorKind });
    }
    if (bare === 'bg-clip-text') clipLayers.add(layer);
    const paint = backgroundPaint(bare);
    if (paint === 'solid') paintLayers.add(layer);
    else if (paint === 'gradient') gradientLayers.add(layer);
    if (GRADIENT_STOP_PATTERN.test(bare) && !bare.endsWith('-transparent')) {
      hasGradientStops = true;
    }
  }
  const opaqueColor = [...colorWinners.values()].some(
    (winner) => winner.kind === 'opaque'
  );
  const transparentColor =
    colorWinners.get('')?.kind === 'transparent' &&
    [...colorWinners].every(
      ([layer, winner]) => layer === '' || winner.kind === 'transparent'
    );
  if (hasGradientStops) {
    for (const layer of gradientLayers) paintLayers.add(layer);
  }
  const clippedBackground = clipLayers.size > 0 && paintLayers.size > 0;
  return { opaqueColor, transparentColor, clippedBackground };
}

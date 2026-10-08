// Text color and clipped-background markers for one element's class
// list. Conflicting colors resolve per layer: within a layer the
// alphabetically last color utility wins (Tailwind v4.3.1 compiled
// order, verified against the app theme), and responsive layers
// ascend above base. Transparent text stays readable when a painted
// background is clipped to the glyphs (bg-clip-text): any clip layer
// plus any paint layer counts, an existential approximation matching
// the viewport handling elsewhere. A bare
// gradient utility paints nothing (unset stops default to
// transparent), so gradients need a painted from/via/to channel
// winner to count.

import { THEME_COLOR_NAMES } from './review-handoff-theme-colors';

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

function isThemeTextColor(color: string): boolean {
  return (
    color.startsWith('text-') &&
    THEME_COLOR_NAMES.has(color.slice('text-'.length))
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

type LayerWinner<Kind> = { token: string; kind: Kind };

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
    color.startsWith('bg-') && THEME_COLOR_NAMES.has(color.slice('bg-'.length))
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

function isZeroAlphaModifier(modifier: string | null): boolean {
  if (modifier === null) return false;
  const alpha = modifier.replace(/^\[|\]$/g, '').replace(/%$/, '');
  const numeric = Number(alpha);
  return !Number.isNaN(numeric) && numeric === 0;
}

const BACKGROUND_ARBITRARY_IMAGE_PATTERN =
  /(url|image-set|image|gradient|element|cross-fade)\s*\(/i;
const BACKGROUND_ARBITRARY_NON_PAINT_PATTERN = /^bg-\[(length|position|size):/;

function backgroundColorKind(utility: string): 'solid' | 'blank' | null {
  // background-color utilities: palette, theme, transparent, current,
  // inherit, and arbitrary colors. transparent/current/inherit and
  // zero alphas occupy sort positions but never paint. Size/position
  // arbitrary values and image-likes stay out of this channel.
  if (BACKGROUND_ARBITRARY_NON_PAINT_PATTERN.test(utility)) return null;
  const [base, modifier] = splitUtilityModifier(utility);
  let color = false;
  if (base.startsWith('bg-[') && base.endsWith(']')) {
    const raw = base.slice('bg-['.length, -1);
    if (BACKGROUND_ARBITRARY_IMAGE_PATTERN.test(raw)) return null;
    if (raw === 'none') return null;
    color = true;
  } else if (
    BACKGROUND_COLOR_PATTERN.test(base) ||
    isThemeBackgroundColor(base) ||
    base === 'bg-transparent' ||
    base === 'bg-current' ||
    base === 'bg-inherit'
  ) {
    color = true;
  }
  if (!color) return null;
  if (
    base === 'bg-transparent' ||
    base === 'bg-current' ||
    base === 'bg-inherit' ||
    (base.startsWith('bg-[') && base.slice('bg-['.length, -1) === 'transparent')
  ) {
    return 'blank';
  }
  return isZeroAlphaModifier(modifier) ? 'blank' : 'solid';
}

type BackgroundImage = {
  token: string;
  rank: number;
  paints: boolean;
  gradient: boolean;
};

function backgroundImageKind(
  utility: string
): Omit<BackgroundImage, 'token'> | null {
  // background-image utilities, probe-ordered (Tailwind v4.3.1): named
  // gradients, arbitrary images, `none` last. Alphabetical order
  // breaks ties within a rank.
  if (BACKGROUND_GRADIENT_PATTERN.test(utility)) {
    const [, modifier] = splitUtilityModifier(utility);
    return { gradient: true, paints: !isZeroAlphaModifier(modifier), rank: 0 };
  }
  if (utility === 'bg-none') {
    return { gradient: false, paints: false, rank: 2 };
  }
  const [base, modifier] = splitUtilityModifier(utility);
  if (!base.startsWith('bg-[') || !base.endsWith(']')) return null;
  if (!BACKGROUND_ARBITRARY_IMAGE_PATTERN.test(base.slice('bg-['.length, -1))) {
    return null;
  }
  return { gradient: false, paints: !isZeroAlphaModifier(modifier), rank: 1 };
}

function gradientStop(
  utility: string
): { channel: string; kind: 'painted' | 'blank' } | null {
  // from/via/to set separate custom properties, so each channel
  // resolves its own alphabetically-last winner per layer (compiled
  // order verified). Only transparent and zero-alpha stops blank a
  // channel: current/inherit depend on unknowable context, so they
  // stay out and assume visible, while stop positions (from-75%
  // sets no color at all) never blank a color winner.
  const channel = GRADIENT_STOP_PATTERN.exec(utility)?.[1];
  if (!channel) return null;
  const [base, modifier] = splitUtilityModifier(utility);
  if (/-current$/.test(base) || /-inherit$/.test(base)) return null;
  if (/-transparent$/.test(base) || isZeroAlphaModifier(modifier)) {
    return { channel, kind: 'blank' };
  }
  return { channel, kind: 'painted' };
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
  const colorWinners = new Map<string, LayerWinner<TextColorKind>>();
  const clipLayers = new Set<string>();
  const backgroundColorWinners = new Map<
    string,
    LayerWinner<'solid' | 'blank'>
  >();
  const backgroundImageWinners = new Map<string, BackgroundImage>();
  const gradientStopWinners = new Map<
    string,
    LayerWinner<'painted' | 'blank'>
  >();
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
    const backgroundColor = backgroundColorKind(bare);
    if (backgroundColor !== null) {
      const winner = backgroundColorWinners.get(layer);
      if (!winner || bare > winner.token)
        backgroundColorWinners.set(layer, {
          token: bare,
          kind: backgroundColor,
        });
    }
    const backgroundImage = backgroundImageKind(bare);
    if (backgroundImage !== null) {
      const winner = backgroundImageWinners.get(layer);
      if (
        !winner ||
        backgroundImage.rank > winner.rank ||
        (backgroundImage.rank === winner.rank && bare > winner.token)
      )
        backgroundImageWinners.set(layer, { token: bare, ...backgroundImage });
    }
    const stop = gradientStop(bare);
    if (stop !== null) {
      const key = `${layer}${stop.channel}`;
      const winner = gradientStopWinners.get(key);
      if (!winner || bare > winner.token)
        gradientStopWinners.set(key, { token: bare, kind: stop.kind });
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
  const paintLayers = new Set<string>();
  for (const [layer, winner] of backgroundColorWinners) {
    if (winner.kind === 'solid') paintLayers.add(layer);
  }
  const hasPaintedStop = [...gradientStopWinners.values()].some(
    (winner) => winner.kind === 'painted'
  );
  for (const [layer, winner] of backgroundImageWinners) {
    if (winner.paints && (!winner.gradient || hasPaintedStop)) {
      paintLayers.add(layer);
    }
  }
  const clippedBackground = clipLayers.size > 0 && paintLayers.size > 0;
  return { opaqueColor, transparentColor, clippedBackground };
}

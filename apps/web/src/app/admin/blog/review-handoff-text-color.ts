// Text color and clipped-background markers for one element's class
// list. Conflicting colors resolve per layer: within a layer the
// naturally last color utility wins (Tailwind v4.3.1 compiled order,
// verified against the app theme). Each evaluation point takes the
// latest applicable per-layer winner, so responsive overrides flip
// the markers at their breakpoint instead of leaking across
// viewports. Transparent text stays readable when a painted
// background is clipped to the glyphs (bg-clip-text) at the same
// point (see ./review-handoff-background-paint).

import { backgroundPaintAt } from './review-handoff-background-paint';
import {
  BREAKPOINT_POINT_COUNT,
  breakpointWinnerAtPoint,
  type ColorScheme,
} from './review-handoff-breakpoints';
import { THEME_COLOR_NAMES } from './review-handoff-theme-colors';
import { compareNaturalOrder } from './review-handoff-utility-order';

const RESPONSIVE_PREFIX_PATTERN = /^(?:(?:max-)?(?:sm|md|lg|xl|2xl):|dark:)+/;
const BACKGROUND_CLIP_PATTERN = /^bg-clip-(.+)$/;

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

const COLOR_FUNCTION_PATTERN =
  /^(?:rgb|hsl|oklch|oklab|lab|lch|hwb|color|color-mix|light-dark)\(/i;
const LENGTH_VALUE_PATTERN = /^-?[\d.]+[a-z%]*$/i;

function isZeroAlphaModifier(modifier: string | null): boolean {
  if (modifier === null) return false;
  const alpha = modifier.replace(/^\[|\]$/g, '').replace(/%$/, '');
  const numeric = Number(alpha);
  return !Number.isNaN(numeric) && numeric === 0;
}

function isLengthLike(raw: string): boolean {
  // Font-size arbitrary values (text-[12px], text-[12px/16px],
  // text-[length:12px]) set no color. A slash denotes
  // size/leading unless a color function owns it (space-separated
  // rgb() alpha), and data-type hints disambiguate the rest.
  if (COLOR_FUNCTION_PATTERN.test(raw)) return false;
  if (/^(length|size):/i.test(raw)) return true;
  if (raw.includes('/')) return true;
  return LENGTH_VALUE_PATTERN.test(raw.replace(/[\s_]+/g, ''));
}

function arbitraryTextColorKind(utility: string): TextColorKind | null {
  // text-[...] / text-(...) arbitrary values: colors participate
  // with their alpha, font sizes do not. current/inherit defer to
  // the ancestor (their semantics), var() is assumed to paint,
  // and anything unrecognized is assumed to paint rather than
  // stripping readable content.
  const open = utility.startsWith('text-[')
    ? 'text-['
    : utility.startsWith('text-(')
      ? 'text-('
      : null;
  if (open === null) return null;
  const closeChar = open.endsWith('[') ? ']' : ')';
  const close = utility.indexOf(closeChar, open.length);
  if (close === -1) return null;
  const raw = utility.slice(open.length, close);
  const rest = utility.slice(close + 1);
  if (rest !== '' && !rest.startsWith('/')) return null;
  const modifier = rest === '' ? null : rest.slice(1);
  const lowered = raw.toLowerCase();
  if (lowered === 'transparent') return 'transparent';
  if (
    lowered === 'currentcolor' ||
    lowered === 'current' ||
    lowered === 'inherit' ||
    lowered === 'initial' ||
    lowered === 'unset'
  ) {
    return 'passthrough';
  }
  if (isLengthLike(raw)) return null;
  return isZeroAlphaModifier(modifier) ? 'transparent' : 'opaque';
}

function textColorKind(utility: string): TextColorKind | null {
  // Non-colors (font-size, alignment, unknown text-*) return null;
  // current/inherit pass the ancestor through.
  if (utility.startsWith('text-[') || utility.startsWith('text-(')) {
    return arbitraryTextColorKind(utility);
  }
  const slash = utility.lastIndexOf('/');
  const color = slash === -1 ? utility : utility.slice(0, slash);
  if (color === 'text-transparent') return 'transparent';
  if (color === 'text-current' || color === 'text-inherit')
    return 'passthrough';
  if (!TEXT_COLOR_PATTERN.test(color) && !isThemeTextColor(color)) return null;
  return isOpaqueColorUtility(utility) ? 'opaque' : 'transparent';
}

/**
 * Text color markers for one element's class list: per evaluation
 * point, the latest applicable per-layer winner decides. An opaque
 * winner renders at its point; transparency needs a transparent
 * winner at that point. clippedAt pairs a bg-clip-text winner with
 * an effectively painted background, which renders transparent
 * glyphs without an opaque color utility.
 */
export function textColorMarkers(
  classes: readonly string[],
  scheme: ColorScheme = 'light'
): {
  opaqueAt: boolean[];
  transparentAt: boolean[];
  clippedAt: boolean[];
} {
  const colorWinners = new Map<string, LayerWinner<TextColorKind>>();
  const clipWinners = new Map<string, string>();
  for (const token of classes) {
    const utility = responsiveUtility(token);
    const bare = utility === null ? token : utility;
    const layer = token.slice(0, token.length - bare.length);
    const colorKind = textColorKind(bare);
    if (colorKind !== null) {
      const winner = colorWinners.get(layer);
      if (!winner || compareNaturalOrder(bare, winner.token) > 0)
        colorWinners.set(layer, { token: bare, kind: colorKind });
    }
    const clip = BACKGROUND_CLIP_PATTERN.exec(bare)?.[1];
    if (clip !== undefined) {
      const winner = clipWinners.get(layer);
      if (!winner || compareNaturalOrder(bare, winner) > 0)
        clipWinners.set(layer, bare);
    }
  }
  const paintAt = backgroundPaintAt(classes, scheme);
  const opaqueAt: boolean[] = [];
  const transparentAt: boolean[] = [];
  const clippedAt: boolean[] = [];
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    const color = breakpointWinnerAtPoint(colorWinners, point, scheme);
    opaqueAt.push(color?.kind === 'opaque');
    transparentAt.push(color?.kind === 'transparent');
    clippedAt.push(
      breakpointWinnerAtPoint(clipWinners, point, scheme) === 'bg-clip-text' &&
        paintAt[point]
    );
  }
  return { opaqueAt, transparentAt, clippedAt };
}

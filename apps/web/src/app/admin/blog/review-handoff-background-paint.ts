// Per-breakpoint background paint winners: whether the element's
// background renders pixels behind glyphs at each evaluation
// point. Within a layer the naturally last utility wins per
// channel (Tailwind v4.3.1 compiled order, verified); across
// layers the rank-latest applicable winner decides each point. A
// solid background color paints unless a painting image covers it;
// a painting non-gradient image paints on its own, while a
// gradient paints when any from/via/to channel is painted (unset
// stops default to transparent but the painted part still
// renders). bg-none falls back to the color.

import {
  BREAKPOINT_POINT_COUNT,
  breakpointWinnerAtPoint,
} from './review-handoff-breakpoints';
import { THEME_COLOR_NAMES } from './review-handoff-theme-colors';
import { compareNaturalOrder } from './review-handoff-utility-order';

const RESPONSIVE_PREFIX_PATTERN = /^(?:max-)?(?:sm|md|lg|xl|2xl):/;
const BACKGROUND_COLOR_PATTERN =
  /^bg-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/;
const BACKGROUND_GRADIENT_PATTERN = /^bg-(?:linear|radial|conic|gradient)-/;
const GRADIENT_STOP_PATTERN = /^(from|via|to)-/;
const BACKGROUND_ARBITRARY_IMAGE_PATTERN =
  /(url|image-set|image|gradient|element|cross-fade)\s*\(/i;
const BACKGROUND_ARBITRARY_NON_PAINT_PATTERN = /^bg-\[(length|position|size):/;

function responsiveUtility(token: string): string | null {
  const match = RESPONSIVE_PREFIX_PATTERN.exec(token);
  return match ? token.slice(match[0].length) : null;
}

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
  // gradients, arbitrary images, `none` last. Natural order breaks
  // ties within a rank.
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
  // resolves its own naturally-last winner per layer (compiled
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

type LayerWinner<Kind> = { token: string; kind: Kind };

export function backgroundPaintAt(classes: readonly string[]): boolean[] {
  const colorWinners = new Map<string, LayerWinner<'solid' | 'blank'>>();
  const imageWinners = new Map<string, BackgroundImage>();
  const stopWinners = new Map<
    string,
    Map<string, LayerWinner<'painted' | 'blank'>>
  >();
  for (const token of classes) {
    const utility = responsiveUtility(token);
    const bare = utility === null ? token : utility;
    const layer = token.slice(0, token.length - bare.length);
    const backgroundColor = backgroundColorKind(bare);
    if (backgroundColor !== null) {
      const winner = colorWinners.get(layer);
      if (!winner || compareNaturalOrder(bare, winner.token) > 0)
        colorWinners.set(layer, { token: bare, kind: backgroundColor });
    }
    const backgroundImage = backgroundImageKind(bare);
    if (backgroundImage !== null) {
      const winner = imageWinners.get(layer);
      if (
        !winner ||
        backgroundImage.rank > winner.rank ||
        (backgroundImage.rank === winner.rank &&
          compareNaturalOrder(bare, winner.token) > 0)
      )
        imageWinners.set(layer, { token: bare, ...backgroundImage });
    }
    const stop = gradientStop(bare);
    if (stop !== null) {
      let channelWinners = stopWinners.get(stop.channel);
      if (!channelWinners) {
        channelWinners = new Map();
        stopWinners.set(stop.channel, channelWinners);
      }
      const winner = channelWinners.get(layer);
      if (!winner || compareNaturalOrder(bare, winner.token) > 0)
        channelWinners.set(layer, { token: bare, kind: stop.kind });
    }
  }
  const paintAt: boolean[] = [];
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    const color = breakpointWinnerAtPoint(colorWinners, point);
    const image = breakpointWinnerAtPoint(imageWinners, point);
    if (image === undefined || !image.paints) {
      paintAt.push(color?.kind === 'solid');
    } else if (!image.gradient) {
      paintAt.push(true);
    } else {
      paintAt.push(
        (['from', 'via', 'to'] as const).some(
          (channel) =>
            breakpointWinnerAtPoint(
              stopWinners.get(channel) ?? new Map(),
              point
            )?.kind === 'painted'
        )
      );
    }
  }
  return paintAt;
}

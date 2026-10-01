import { colord, extend } from 'colord';
import namesPlugin from 'colord/plugins/names';
import type { MerchantBlogOgImageData } from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-data';

extend([namesPlugin]);

const DEFAULT_BACKGROUND = '#1a1a2e';

export type BlogOgBrandColors = {
  background: string;
  primary: string;
  accent: string;
};

function getOpaqueBlogOgBackground(value: string | null): string {
  const normalized = value?.trim() || DEFAULT_BACKGROUND;
  const parsed = colord(normalized);
  if (!parsed.isValid()) return DEFAULT_BACKGROUND;

  const foreground = parsed.toRgb();
  if (foreground.a >= 1) return normalized;

  const backing = colord(DEFAULT_BACKGROUND).toRgb();
  const composite = (channel: number, backingChannel: number) =>
    Math.round(channel * foreground.a + backingChannel * (1 - foreground.a));
  return `rgb(${composite(foreground.r, backing.r)}, ${composite(
    foreground.g,
    backing.g
  )}, ${composite(foreground.b, backing.b)})`;
}

export function getBlogOgBrandColors(
  data: MerchantBlogOgImageData
): BlogOgBrandColors {
  return {
    // Satori emits transparent pixels for alpha-bearing CSS colors. Flatten
    // them onto the same opaque fallback used by the card before computing
    // text contrast, so downstream social surfaces cannot change readability.
    background: getOpaqueBlogOgBackground(data.merchantBrandColors.background),
    primary: data.merchantBrandColors.primary || '#3B82F6',
    accent: data.merchantBrandColors.accent || '#F59E0B',
  };
}

function toRgba(color: string, fallback: string, opacity: number) {
  const normalized = color.trim();
  const hexMatch = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hexMatch) return fallback;

  const hex = hexMatch[1];
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((value) => `${value}${value}`)
          .join('')
      : hex;
  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

export function getTransparentBlogOgBrandColors(colors: BlogOgBrandColors) {
  return {
    primary20: toRgba(colors.primary, 'rgba(59, 130, 246, 0.2)', 0.2),
    primary15: toRgba(colors.primary, 'rgba(59, 130, 246, 0.15)', 0.15),
    primary13: toRgba(colors.primary, 'rgba(59, 130, 246, 0.13)', 0.13),
    accent15: toRgba(colors.accent, 'rgba(245, 158, 11, 0.15)', 0.15),
  };
}

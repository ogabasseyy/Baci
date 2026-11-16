import Colors from '@/constants/Colors';
import type { ImeiCheckerColors } from './imei-check.types';

/** Red, green and blue (0-255) of a #rgb, #rrggbb(aa) or rgb()/rgba() colour. */
function readRgb(value: string): [number, number, number] | null {
  const text = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/.exec(text);
  if (short)
    return [short[1], short[2], short[3]].map((d) =>
      Number.parseInt(`${d}${d}`, 16)
    ) as [number, number, number];
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(
    text
  );
  if (long)
    return [long[1], long[2], long[3]].map((h) => Number.parseInt(h, 16)) as [
      number,
      number,
      number,
    ];
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(text);
  return fn ? [Number(fn[1]), Number(fn[2]), Number(fn[3])] : null;
}

/**
 * Dark when the page background is dim, judged by brightness rather than by
 * equality with white, so an off-white light theme still reads as light.
 */
export function isImeiDark(colors: ImeiCheckerColors) {
  // The app's own themes first; brightness only for anything else.
  if (colors.background === Colors.dark.background) return true;
  if (colors.background === Colors.light.background) return false;
  const rgb = readRgb(colors.background);
  // Can't tell: light, the safer look on the app's white cards.
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

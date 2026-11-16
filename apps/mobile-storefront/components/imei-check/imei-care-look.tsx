import { StyleSheet, View } from 'react-native';
import Colors from '@/constants/Colors';
import type { ImeiCheckerColors } from './imei-check.types';

/**
 * The Ogabassey "device care" look from the refreshed home and service
 * screens: a deep burgundy hero, ticket cards with a small notch cut into the
 * top edge, and soft pink icon circles.
 */
export const IMEI_CARE = {
  hero: '#351521',
  heroText: '#ffffff',
  heroBody: '#f5dce2',
  heroAccent: '#ffc9d1',
  heroChip: 'rgba(255,255,255,0.1)',
  cardRadius: 15,
} as const;

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
  if (!rgb) return colors.background !== colors.white;
  const [r, g, b] = rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

/** Soft pink circle behind an icon, and the icon colour on it. */
export function imeiCareIcon(colors: ImeiCheckerColors) {
  const dark = isImeiDark(colors);
  return {
    background: dark ? '#46232e' : '#fce8ed',
    color: dark ? '#ffffff' : '#a7182c',
  };
}

/** The ticket notch: a half-moon bite out of the card's top edge. */
export function ImeiTicketNotch({ colors }: { colors: ImeiCheckerColors }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.notch,
        { backgroundColor: colors.background, borderColor: colors.border },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  notch: {
    borderBottomLeftRadius: 9,
    borderBottomRightRadius: 9,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    height: 7,
    position: 'absolute',
    right: 20,
    top: -1,
    width: 18,
    zIndex: 1,
  },
});

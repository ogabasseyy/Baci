import { StyleSheet, View } from 'react-native';
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

/**
 * Dark when the page background is dim, judged by brightness rather than by
 * equality with white, so an off-white light theme still reads as light.
 */
export function isImeiDark(colors: ImeiCheckerColors) {
  const hex = /^#?([0-9a-f]{6})/i.exec(colors.background.trim())?.[1];
  if (!hex) return colors.background !== colors.white;
  const [r, g, b] = [0, 2, 4].map((at) =>
    Number.parseInt(hex.slice(at, at + 2), 16)
  );
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

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

export function isImeiDark(colors: ImeiCheckerColors) {
  return colors.background !== colors.white;
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

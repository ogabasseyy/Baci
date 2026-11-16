import { StyleSheet, View } from 'react-native';
import type { ImeiCheckerColors } from './imei-check.types';

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

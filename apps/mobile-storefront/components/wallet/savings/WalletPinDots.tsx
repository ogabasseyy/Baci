import { StyleSheet, View } from 'react-native';
import type Colors from '@/constants/Colors';

type WalletColors = (typeof Colors)['light'];

const MIN_SLOTS = 4;
const MAX_DIGITS = 6;

/**
 * The PIN as dots: four boxes, growing to five or six as those digits are typed
 * (or a fixed count, for a code of known length). Only the count of digits is
 * shown or announced, never the digits.
 */
export function WalletPinDots({
  colors,
  label,
  length,
  fixedSlots,
}: {
  colors: WalletColors;
  label: string;
  length: number;
  fixedSlots?: number;
}) {
  // Four boxes, growing only as a fifth or sixth digit is typed: an empty
  // extra box after four read as "one more digit needed".
  const slots = fixedSlots ?? Math.min(MAX_DIGITS, Math.max(MIN_SLOTS, length));
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${length} of ${fixedSlots ?? MAX_DIGITS} digits entered`}
      style={styles.dots}
    >
      {Array.from({ length: slots }, (_, index) => {
        const filled = index < length;
        const current = index === length;
        return (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed slot positions
            key={index}
            style={[
              styles.slot,
              {
                borderColor: current ? colors.primary : colors.border,
                borderWidth: current ? 1.5 : 1,
              },
            ]}
          >
            {filled ? (
              <View style={[styles.dot, { backgroundColor: colors.text }]} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  // Up to 44 wide, narrower when six boxes would not fit the sheet.
  slot: {
    alignItems: 'center',
    borderRadius: 12,
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    height: 52,
    justifyContent: 'center',
    maxWidth: 44,
  },
  dot: { borderRadius: 6, height: 12, width: 12 },
});

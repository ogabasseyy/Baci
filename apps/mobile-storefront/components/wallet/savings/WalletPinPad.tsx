import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { triggerHaptic } from '@/hooks/use-haptics';

type WalletColors = (typeof Colors)['light'];

const MIN_SLOTS = 4;
const MAX_DIGITS = 6;
const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
];

/**
 * The PIN as dots: four boxes, growing to five or six as the customer types.
 * Only the count of digits is shown or announced, never the digits.
 */
export function WalletPinDots({
  colors,
  label,
  length,
}: {
  colors: WalletColors;
  label: string;
  length: number;
}) {
  const slots = Math.min(MAX_DIGITS, Math.max(MIN_SLOTS, length + 1));
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${length} of ${MAX_DIGITS} digits entered`}
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

/**
 * An in-sheet number pad: no phone keyboard, so the sheet never jumps and a
 * tap always lands on the key the customer sees.
 */
export function WalletPinPad({
  colors,
  disabled,
  onChange,
  value,
}: {
  colors: WalletColors;
  disabled: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <View style={styles.pad}>
      {ROWS.map((row) => (
        <View key={row.join('')} style={styles.row}>
          {row.map((key) =>
            key === '' ? (
              <View key="blank" style={styles.key} />
            ) : (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={key === 'del' ? 'Delete digit' : key}
                disabled={disabled}
                onPress={() => {
                  triggerHaptic('selection');
                  if (key === 'del') onChange(value.slice(0, -1));
                  else if (value.length < MAX_DIGITS)
                    onChange(`${value}${key}`);
                }}
                style={styles.key}
              >
                {key === 'del' ? (
                  <Ionicons
                    name="backspace-outline"
                    size={24}
                    color={colors.text}
                  />
                ) : (
                  <Text style={[styles.keyText, { color: colors.text }]}>
                    {key}
                  </Text>
                )}
              </Pressable>
            )
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  slot: {
    alignItems: 'center',
    borderRadius: 12,
    height: 52,
    justifyContent: 'center',
    width: 44,
  },
  dot: { borderRadius: 6, height: 12, width: 12 },
  pad: { alignSelf: 'stretch', gap: 4 },
  row: { flexDirection: 'row', gap: 4 },
  // Equal thirds whatever each key holds, so 0 sits under 8.
  key: {
    alignItems: 'center',
    borderRadius: 14,
    flexBasis: 0,
    flexGrow: 1,
    height: 54,
    justifyContent: 'center',
  },
  keyText: { fontSize: 24, fontWeight: '500' },
});

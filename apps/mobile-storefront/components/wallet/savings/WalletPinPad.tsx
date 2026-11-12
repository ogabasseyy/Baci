import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { triggerHaptic } from '@/hooks/use-haptics';

type WalletColors = (typeof Colors)['light'];

const MAX_DIGITS = 6;
const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
];

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

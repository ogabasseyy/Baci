import { Text, TextInput, View } from 'react-native';
import {
  normalizeAmountInput,
  themedInputStyle,
} from './start-savings.helpers';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';

export function SavingsAmountInput({
  colors,
  label,
  value,
  onChangeText,
}: {
  colors: StartSavingsColors;
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View
      style={[
        styles.input,
        themedInputStyle(colors),
        { flexDirection: 'row', alignItems: 'center', gap: 8 },
      ]}
    >
      <Text style={{ color: colors.text, fontSize: 26, fontWeight: '700' }}>
        ₦
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={normalizeAmountInput(value).replace(
          /\B(?=(\d{3})+(?!\d))/g,
          ','
        )}
        onChangeText={(text) => onChangeText(normalizeAmountInput(text))}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={colors.placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          paddingVertical: 6,
          color: colors.text,
          fontSize: 26,
          fontWeight: '700',
        }}
      />
    </View>
  );
}

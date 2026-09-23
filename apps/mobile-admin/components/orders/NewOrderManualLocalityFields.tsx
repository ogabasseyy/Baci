import { Text, TextInput, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import { styles } from './new-order.styles';

interface NewOrderManualLocalityFieldsProps {
  city: string;
  colors: ThemeColors;
  onCityChange: (text: string) => void;
  onStateChange: (text: string) => void;
  state: string;
}

export function NewOrderManualLocalityFields({
  city,
  colors,
  onCityChange,
  onStateChange,
  state,
}: NewOrderManualLocalityFieldsProps) {
  return (
    <View style={[styles.rowBetween, { gap: 12, marginTop: 8 }]}>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.label,
            { color: colors.textSecondary, marginBottom: 4 },
          ]}
        >
          City
        </Text>
        <TextInput
          onChangeText={onCityChange}
          placeholder="City"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              borderWidth: 1,
              color: colors.text,
            },
          ]}
          value={city}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.label,
            { color: colors.textSecondary, marginBottom: 4 },
          ]}
        >
          State
        </Text>
        <TextInput
          onChangeText={onStateChange}
          placeholder="State"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              borderWidth: 1,
              color: colors.text,
            },
          ]}
          value={state}
        />
      </View>
    </View>
  );
}

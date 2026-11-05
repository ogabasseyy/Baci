import { Text, TextInput } from 'react-native';
import type Colors from '@/constants/Colors';
import { styles } from './WalletPinSettingsScreen.styles';

type Props = {
  colors: (typeof Colors)['light'];
  label: string;
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
};

/** A masked PIN box: digits only, at most 6, and no autofill or suggestions. */
export function WalletPinField({
  colors,
  label,
  value,
  editable,
  onChange,
}: Props) {
  return (
    <>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {label.toUpperCase()}
      </Text>
      <TextInput
        accessibilityLabel={label}
        style={[
          styles.input,
          {
            backgroundColor: colors.muted,
            borderColor: colors.border,
            color: colors.text,
          },
        ]}
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, 6))}
        editable={editable}
        secureTextEntry
        keyboardType="number-pad"
        maxLength={6}
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        textContentType="none"
      />
    </>
  );
}

import { Text, TextInput, View } from 'react-native';
import { repairBookingStyles as styles } from '@/components/repairs/repair-booking.styles';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

interface RepairTextFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}

/**
 * One labelled text input for the repair booking form, with a theme-aware
 * error state. Extracted so `RepairBookingForm` stays under the 300-line cap
 * and every field renders identically.
 */
export function RepairTextField({
  label,
  value,
  onChangeText,
  error,
  placeholder,
  multiline = false,
  keyboardType = 'default',
  autoCapitalize,
}: RepairTextFieldProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const hasError = Boolean(error);

  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <TextInput
        style={[
          styles.input,
          multiline ? styles.multiline : null,
          {
            backgroundColor: colors.muted,
            borderColor: hasError ? colors.error : colors.border,
            color: colors.text,
          },
        ]}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={keyboardType === 'email-address' ? false : undefined}
        accessibilityLabel={label}
      />
      {error ? (
        <Text style={[styles.fieldError, { color: colors.error }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

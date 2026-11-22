import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';

const TEMPLATE = 'DD/MM/YYYY';

/** A native editable value with a non-interactive, persistent date guide. */
export function OxygenBirthDateInput({
  value,
  onChangeText,
  onBlur,
  error,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onBlur: () => void;
  error?: boolean;
}) {
  const colors = useOxygenColors();
  const digitsEntered = value.replace(/\D/g, '').length;
  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.primaryLowOpacity,
          borderColor: error ? colors.error : colors.border,
        },
      ]}
    >
      <TextInput
        accessibilityLabel="Type date of birth"
        accessibilityHint="Day, month, then four-digit year"
        value={value}
        keyboardType="number-pad"
        maxLength={10}
        onBlur={onBlur}
        onChangeText={onChangeText}
        selectionColor={colors.primary}
        cursorColor={colors.primary}
        style={[styles.typography, styles.input]}
      />
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.guide, { pointerEvents: 'none' }]}
      >
        <Text style={[styles.typography, { color: colors.text }]}>
          {TEMPLATE.split('').map((character, index) => (
            <Text
              // biome-ignore lint/suspicious/noArrayIndexKey: Fixed date-format slots never reorder.
              key={index}
              style={{
                color: (
                  character === '/'
                    ? digitsEntered >= (index === 2 ? 2 : 4)
                    : !!value[index]
                )
                  ? colors.text
                  : colors.placeholder,
              }}
            >
              {value[index] ?? character}
            </Text>
          ))}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative', borderWidth: 1, borderRadius: 16 },
  typography: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '600',
    includeFontPadding: false,
    letterSpacing: 1,
  },
  input: { padding: 16, margin: 0, color: 'transparent' },
  guide: { position: 'absolute', top: 16, left: 16, right: 16 },
});

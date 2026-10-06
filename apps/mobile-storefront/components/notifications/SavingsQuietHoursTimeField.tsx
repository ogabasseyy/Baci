import { Text, TextInput, View } from 'react-native';
import { styles } from './SavingsNotificationPreferences.styles';

export function SavingsQuietHoursTimeField({
  color,
  label,
  isSaving,
  onChangeText,
  onEndEditing,
  value,
}: {
  color: string;
  label: string;
  isSaving: boolean;
  onChangeText: (value: string) => void;
  onEndEditing: () => void;
  value: string;
}) {
  return (
    <View style={styles.timeField}>
      <Text style={[styles.timeZoneLabel, { color }]}>{label}</Text>
      <TextInput
        accessibilityLabel={`Quiet hours ${label.toLowerCase()}`}
        autoCapitalize="none"
        editable={!isSaving}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        onChangeText={onChangeText}
        onEndEditing={onEndEditing}
        style={[styles.timeInput, { borderColor: color, color }]}
        value={value}
      />
    </View>
  );
}

import { Switch, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { styles } from './SavingsNotificationPreferences.styles';

export function SavingsPreferenceSwitch({
  colors,
  description,
  label,
  isSaving,
  onValueChange,
  value,
}: {
  colors: typeof Colors.light;
  description: string;
  label: string;
  isSaving: boolean;
  onValueChange: (value: boolean) => void;
  value: boolean;
}) {
  return (
    <View style={[styles.preferenceRow, { borderTopColor: colors.border }]}>
      <View style={styles.preferenceCopy}>
        <Text style={[styles.preferenceLabel, { color: colors.text }]}>
          {label}
        </Text>
        <Text
          style={[
            styles.preferenceDescription,
            { color: colors.textSecondary },
          ]}
        >
          {description}
        </Text>
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityState={{ disabled: isSaving }}
        disabled={isSaving}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        value={value}
      />
    </View>
  );
}

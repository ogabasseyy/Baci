import { Switch, Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import { styles } from './notifications.styles';

interface FollowUpAlertsSettingProps {
  colors: ThemeColors;
  enabled: boolean;
  onValueChange: (value: boolean) => void;
}

export function FollowUpAlertsSetting({
  colors,
  enabled,
  onValueChange,
}: FollowUpAlertsSettingProps) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingInfo}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>
          Follow-up Alerts
        </Text>
        <Text style={[styles.settingDesc, { color: colors.textSecondary }]}>
          Alert me when a customer creates an invoice that needs follow-up
        </Text>
      </View>
      <Switch
        value={enabled}
        onValueChange={onValueChange}
        accessibilityRole="switch"
        accessibilityLabel="Follow-up alerts"
        accessibilityHint="Enable alerts for invoices that need follow-up"
        trackColor={{
          false: colors.border,
          true: `${colors.primary}50`,
        }}
        thumbColor={enabled ? colors.card : colors.textMuted}
      />
    </View>
  );
}

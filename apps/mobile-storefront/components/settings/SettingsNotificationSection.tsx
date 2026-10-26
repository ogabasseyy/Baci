import { ActivityIndicator, Switch, Text } from 'react-native';
import type Colors from '@/constants/Colors';
import { SettingsCardSection } from './SettingsCardSection';
import { SettingsSectionRow } from './SettingsSectionRow';
import { styles } from './styles';

type SettingsNotificationSectionProps = {
  colors: typeof Colors.light;
  error?: string | null;
  isLoading: boolean;
  isRegistered: boolean;
  onToggle: (enabled: boolean) => void;
};

export function SettingsNotificationSection({
  colors,
  error,
  isLoading,
  isRegistered,
  onToggle,
}: SettingsNotificationSectionProps) {
  return (
    <SettingsCardSection
      cardBackgroundColor={colors.card}
      cardBorderColor={colors.border}
      title="NOTIFICATIONS"
      titleColor={colors.textSecondary}
      delay={200}
    >
      <SettingsSectionRow
        icon="notifications-outline"
        iconBackgroundColor={`${colors.primary}15`}
        iconColor={colors.primary}
        label="Push Notifications"
        labelColor={colors.text}
        subtitle="Order updates, deals, and alerts"
        subtitleColor={colors.textSecondary}
        right={
          isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Switch
              value={isRegistered}
              onValueChange={onToggle}
              trackColor={{
                false: colors.border,
                true: colors.primary,
              }}
              accessibilityLabel="Toggle push notifications"
            />
          )
        }
      />
      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLabel={error}
          accessibilityLiveRegion="polite"
          style={[styles.notificationError, { color: colors.error }]}
        >
          {error}
        </Text>
      ) : null}
    </SettingsCardSection>
  );
}

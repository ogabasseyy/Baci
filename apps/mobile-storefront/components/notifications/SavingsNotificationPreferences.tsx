import { useEffect, useState } from 'react';
import { ActivityIndicator, Switch, Text, TextInput, View } from 'react-native';
import { formatDateTimeDisplay } from '@/components/ui/format-date-time-display';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type {
  SavingsNotificationPreferencesPatch,
  SavingsNotificationPreferences as SavingsNotificationPreferencesValue,
} from '@/schemas/savings-notifications';
import { styles } from './SavingsNotificationPreferences.styles';

type SavingsNotificationPreferencesProps = {
  isSaving: boolean;
  onUpdate: (preferences: SavingsNotificationPreferencesPatch) => Promise<void>;
  preferences: SavingsNotificationPreferencesValue;
};

export function SavingsNotificationPreferences({
  isSaving,
  onUpdate,
  preferences,
}: SavingsNotificationPreferencesProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [quietHoursStart, setQuietHoursStart] = useState(
    preferences.quietHoursStart
  );
  const [quietHoursEnd, setQuietHoursEnd] = useState(preferences.quietHoursEnd);
  const [timeZone, setTimeZone] = useState(preferences.timeZone);

  useEffect(() => {
    setQuietHoursStart(preferences.quietHoursStart);
    setQuietHoursEnd(preferences.quietHoursEnd);
    setTimeZone(preferences.timeZone);
  }, [
    preferences.quietHoursEnd,
    preferences.quietHoursStart,
    preferences.timeZone,
  ]);

  const savePreference = (patch: SavingsNotificationPreferencesPatch) => {
    if (isSaving) return;
    void onUpdate(patch).catch(() => {
      setQuietHoursStart(preferences.quietHoursStart);
      setQuietHoursEnd(preferences.quietHoursEnd);
      setTimeZone(preferences.timeZone);
    });
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.heading}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>
            Savings alerts
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Choose which plan updates reach you.
          </Text>
        </View>
        {isSaving ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : null}
      </View>

      <PreferenceSwitch
        colors={colors}
        description="Progress and streak motivation"
        label="Encouragement"
        isSaving={isSaving}
        onValueChange={(encouragementEnabled) =>
          savePreference({ encouragementEnabled })
        }
        value={preferences.encouragementEnabled}
      />
      <PreferenceSwitch
        colors={colors}
        description="Only sent when you opt in"
        label="Weekly savings summary"
        isSaving={isSaving}
        onValueChange={(weeklySummaryEnabled) =>
          savePreference({ weeklySummaryEnabled })
        }
        value={preferences.weeklySummaryEnabled}
      />
      <PreferenceSwitch
        colors={colors}
        description="When plan interest is credited"
        label="Interest alerts"
        isSaving={isSaving}
        onValueChange={(interestAlertsEnabled) =>
          savePreference({ interestAlertsEnabled })
        }
        value={preferences.interestAlertsEnabled}
      />

      <View style={[styles.quietHours, { borderTopColor: colors.border }]}>
        <Text style={[styles.quietHoursTitle, { color: colors.text }]}>
          Quiet hours
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          No savings push alerts are sent between these times.
        </Text>
        <Text
          accessibilityLabel="Quiet hours summary"
          style={[styles.subtitle, { color: colors.textSecondary }]}
        >
          {formatDateTimeDisplay(quietHoursStart, 'time')} –{' '}
          {formatDateTimeDisplay(quietHoursEnd, 'time')} (use 24-hour HH:MM)
        </Text>
        <View style={styles.timeFields}>
          <TimeField
            color={colors.text}
            label="From"
            isSaving={isSaving}
            onChangeText={setQuietHoursStart}
            onEndEditing={() =>
              savePreference({ quietHoursStart: quietHoursStart.trim() })
            }
            value={quietHoursStart}
          />
          <TimeField
            color={colors.text}
            label="To"
            isSaving={isSaving}
            onChangeText={setQuietHoursEnd}
            onEndEditing={() =>
              savePreference({ quietHoursEnd: quietHoursEnd.trim() })
            }
            value={quietHoursEnd}
          />
        </View>
        <Text style={[styles.timeZoneLabel, { color: colors.textSecondary }]}>
          Time zone
        </Text>
        <TextInput
          accessibilityLabel="Savings notification time zone"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSaving}
          onChangeText={setTimeZone}
          onEndEditing={() => savePreference({ timeZone: timeZone.trim() })}
          placeholder="Africa/Lagos"
          placeholderTextColor={colors.textSecondary}
          style={[
            styles.timeZoneInput,
            { borderColor: colors.border, color: colors.text },
          ]}
          value={timeZone}
        />
      </View>
    </View>
  );
}

function PreferenceSwitch({
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

function TimeField({
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

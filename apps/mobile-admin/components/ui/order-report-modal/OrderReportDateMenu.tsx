import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

const PRESETS = [
  'Today',
  'Yesterday',
  'Last 7 Days',
  'Last 30 Days',
  'This Month',
] as const;

type OrderReportPreset = (typeof PRESETS)[number];

interface OrderReportDateMenuProps {
  dateRangeLabel: string;
  onCustomRangeSelect?: () => void;
  onPresetSelect?: (preset: OrderReportPreset) => void;
  onToggleDropdown?: () => void;
  showDropdown: boolean;
}

export function OrderReportDateMenu({
  dateRangeLabel,
  onCustomRangeSelect,
  onPresetSelect,
  onToggleDropdown,
  showDropdown,
}: OrderReportDateMenuProps) {
  const { colors, shadows } = useTheme();
  const canChangeDate = Boolean(onCustomRangeSelect && onToggleDropdown);

  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Text
          style={[
            styles.subtitle,
            { color: colors.textSecondary, marginBottom: 0 },
          ]}
        >
          Summary for:{' '}
          <Text
            style={{
              color: colors.text,
              fontFamily: TYPOGRAPHY.fontFamily.semiBold,
            }}
          >
            {dateRangeLabel}
          </Text>
        </Text>

        {canChangeDate ? (
          <Pressable
            accessibilityHint="Opens date range preset menu"
            accessibilityLabel="Change date range"
            accessibilityRole="button"
            onPress={onToggleDropdown}
            style={styles.changeButton}
          >
            <Text style={[styles.changeText, { color: colors.primary }]}>
              Change
            </Text>
            <Ionicons name="create-outline" size={16} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
      {canChangeDate && showDropdown ? (
        <View
          style={[
            styles.dropdown,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
            shadows.md,
          ]}
        >
          {PRESETS.map((preset) => (
            <Pressable
              accessibilityLabel={`Select ${preset}`}
              accessibilityRole="button"
              key={preset}
              onPress={() => onPresetSelect?.(preset)}
              style={[
                styles.dropdownItem,
                { borderBottomColor: `${colors.border}40` },
              ]}
            >
              <Text style={[styles.dropdownText, { color: colors.text }]}>
                {preset}
              </Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityLabel="Select custom date range"
            accessibilityRole="button"
            onPress={onCustomRangeSelect}
            style={[styles.dropdownItem, { borderBottomWidth: 0 }]}
          >
            <Text
              style={[
                styles.dropdownText,
                {
                  color: colors.primary,
                  fontFamily: TYPOGRAPHY.fontFamily.semiBold,
                },
              ]}
            >
              Custom Range…
            </Text>
            <Ionicons
              name="calendar-outline"
              size={14}
              color={colors.primary}
            />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  subtitle: {
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    fontSize: TYPOGRAPHY.size.sm,
  },
  changeButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  changeText: {
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    fontSize: TYPOGRAPHY.size.sm,
  },
  dropdown: {
    alignSelf: 'flex-end',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    minWidth: 160,
    padding: 4,
  },
  dropdownItem: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dropdownText: {
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    fontSize: TYPOGRAPHY.size.sm,
  },
});

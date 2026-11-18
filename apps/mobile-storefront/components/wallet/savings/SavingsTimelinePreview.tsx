import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { formatDateTimeDisplay } from '@/components/ui/format-date-time-display';
import { BRAND, SPACING } from '@/constants/Colors';
import type { SavingsFrequency } from './start-savings.helpers';
import type { StartSavingsColors } from './start-savings.types';

export function SavingsTimelinePreview({
  colors,
  targetAmount,
  contributionAmount,
  frequency,
  maturityDate,
  initialContributionEnabled,
}: {
  colors: StartSavingsColors;
  targetAmount: number;
  contributionAmount: number;
  frequency: SavingsFrequency;
  maturityDate: string;
  initialContributionEnabled: boolean;
}) {
  if (
    !Number.isFinite(targetAmount) ||
    !Number.isFinite(contributionAmount) ||
    targetAmount <= 0 ||
    contributionAmount <= 0 ||
    !maturityDate
  ) {
    return null;
  }

  // One headline (the number of payments) and the end date: a separate
  // "about N months" span counted the gaps between payments, so it read one
  // short of the payment count beside it.
  const count = Math.ceil(targetAmount / contributionAmount);

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.header}>
        <Ionicons name="calendar-outline" size={16} color={BRAND.primary} />
        <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>
          Your savings timeline
        </Text>
      </View>
      <Text style={[styles.duration, { color: colors.text }]}>
        {count} {frequency} contribution{count === 1 ? '' : 's'}
      </Text>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <View style={styles.dateRow}>
        <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>
          Estimated completion
        </Text>
        <Text style={[styles.dateValue, { color: colors.text }]}>
          {formatDateTimeDisplay(maturityDate, 'date')}
        </Text>
      </View>
      {initialContributionEnabled ? (
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          Estimate excludes your upfront contribution.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: SPACING.md,
    gap: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: {
    fontSize: 12,
    fontWeight: '600',
  },
  duration: { fontSize: 21, fontWeight: '700' },
  divider: { height: 1, marginVertical: SPACING.xs },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: SPACING.sm,
    rowGap: 4,
  },
  dateLabel: { fontSize: 11 },
  dateValue: { fontSize: 11, fontWeight: '700' },
  note: { fontSize: 10, lineHeight: 18, marginTop: 2 },
});

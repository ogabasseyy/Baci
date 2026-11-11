import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { RADIUS, SPACING } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { getSavingsEncouragement } from './get-savings-encouragement';
import { getSavingsProgress } from './get-savings-progress';
import { getSavingsVariantPresentation } from './get-savings-variant-presentation';
import { getWeeklySavingsNudge } from './get-weekly-savings-nudge';
import { SavingsGoalConditionArtwork } from './SavingsGoalConditionArtwork';
import { SavingsProgressMeter } from './SavingsProgressMeter';

/**
 * Top of the savings sheet: what is being saved for, how far along it is, a
 * cheer that matches the progress, and a weekly pace when the goal has a date.
 */
export function SavingsGoalSummary({
  colors,
  goal,
  onResolveVariant,
}: {
  colors: (typeof Colors)['light'];
  goal: WalletActiveSavingsGoal;
  onResolveVariant?: () => void;
}) {
  const { displayPercent, percent } = getSavingsProgress(goal);
  const amountLeft = Math.max(0, goal.target_amount - goal.current_amount);
  const { colour, details, storage } = getSavingsVariantPresentation(
    goal.product_variant_label
  );
  const cheer = getSavingsEncouragement(percent, goal.current_amount);
  const nudge =
    goal.status === 'completed'
      ? null
      : getWeeklySavingsNudge({
          maturityDate: goal.maturity_date,
          remaining: amountLeft,
        });
  return (
    <>
      <View style={styles.contentRow}>
        <SavingsGoalConditionArtwork
          colors={colors}
          goal={goal}
          imageRequestSize={128}
          size={64}
        />
        <View style={styles.progressPane}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>
            SAVING TOWARDS
          </Text>
          <Text style={[styles.goalTitle, { color: colors.text }]}>
            {goal.title}
          </Text>
          <View style={styles.metaRow}>
            {storage ? (
              <Text
                style={[
                  styles.metaPill,
                  { backgroundColor: colors.muted, color: colors.text },
                ]}
              >
                {storage}
              </Text>
            ) : null}
            {details ? (
              <Text style={[styles.detail, { color: colors.textSecondary }]}>
                {details}
              </Text>
            ) : null}
          </View>
          {goal.selection_unresolved ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              Choose the exact device variant before buying. This plan does not
              guess a model, storage or colour.
            </Text>
          ) : null}
          {goal.status === 'completed' &&
          goal.selection_unresolved &&
          goal.variant_resolution_options?.length ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Resolve savings device variant"
              onPress={onResolveVariant}
              style={[
                styles.variantButton,
                { borderColor: colors.primaryLowOpacity },
              ]}
            >
              <Text style={[styles.variantText, { color: colors.text }]}>
                Choose exact variant
              </Text>
            </Pressable>
          ) : null}
        </View>
        {colour ? (
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Device colour: ${colour.name}`}
            style={[
              styles.colourSwatch,
              {
                backgroundColor: colour.hex,
                borderColor: colors.textSecondary,
              },
            ]}
          />
        ) : null}
      </View>
      <View
        style={[
          styles.progressCard,
          {
            backgroundColor: colors.primaryLowOpacity,
            borderColor: colors.primaryLowOpacity,
          },
        ]}
      >
        <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>
          YOUR PROGRESS
        </Text>
        <View style={styles.amountRow}>
          <Text style={[styles.saved, { color: colors.text }]}>
            {formatNgnCurrency(goal.current_amount)} saved
          </Text>
          <Text style={[styles.small, { color: colors.textSecondary }]}>
            {formatNgnCurrency(goal.target_amount)} target
          </Text>
        </View>
        <SavingsProgressMeter
          accessibilityLabel="Savings plan progress details"
          colors={colors}
          percent={percent}
        />
        <View style={styles.amountRow}>
          <Text style={[styles.small, { color: colors.textSecondary }]}>
            {formatNgnCurrency(amountLeft)} left
          </Text>
          <Text style={[styles.small, { color: colors.textSecondary }]}>
            <Text style={{ color: colors.primary }}>{displayPercent}</Text>{' '}
            complete
          </Text>
        </View>
        <View style={styles.encouragement}>
          <View
            style={[styles.accentDot, { backgroundColor: colors.primary }]}
          />
          <View style={styles.encouragementCopy}>
            <Text style={[styles.cheerTitle, { color: colors.primary }]}>
              {cheer.title}
            </Text>
            <Text style={[styles.cheerBody, { color: colors.textSecondary }]}>
              {cheer.body}
            </Text>
          </View>
        </View>
        {nudge ? (
          <Text style={[styles.nudge, { color: colors.text }]}>
            {nudge.label}
          </Text>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5 },
  encouragement: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  encouragementCopy: { flex: 1, gap: 3 },
  accentDot: { width: 7, height: 7, borderRadius: 4, marginTop: 7 },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  progressPane: {
    borderRadius: RADIUS.lg,
    flex: 1,
    gap: SPACING.xs,
    minWidth: 0,
    paddingVertical: SPACING.xs,
  },
  goalTitle: { fontSize: 16, lineHeight: 23, fontWeight: '700' },
  cheerTitle: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  cheerBody: { fontSize: 12, lineHeight: 18 },
  colourSwatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    marginTop: 20,
  },
  detail: { fontSize: 11, lineHeight: 16 },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginTop: SPACING.xs,
  },
  metaPill: {
    borderRadius: RADIUS.full,
    fontSize: 10,
    fontWeight: '600',
    overflow: 'hidden',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
  },
  hint: { fontSize: 13, lineHeight: 18, marginTop: SPACING.sm },
  variantButton: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: SPACING.sm,
    minHeight: 44,
  },
  variantText: { fontSize: 13, fontWeight: '600' },
  progressCard: {
    borderRadius: RADIUS['2xl'],
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    justifyContent: 'space-between',
  },
  saved: { flexShrink: 1, fontSize: 22, fontWeight: '700' },
  small: { flexShrink: 1, fontSize: 11, fontWeight: '500' },
  nudge: { fontSize: 11, fontWeight: '500', lineHeight: 18 },
});

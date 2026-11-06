import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { RADIUS, SPACING } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { formatProductConditionDisplay } from '@/types/product';
import { getSavingsEncouragement } from './get-savings-encouragement';
import { getSavingsProgress } from './get-savings-progress';
import { getWeeklySavingsNudge } from './get-weekly-savings-nudge';
import { SavingsGoalArtwork } from './SavingsGoalArtwork';
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
  const { percent } = getSavingsProgress(goal);
  const amountLeft = Math.max(0, goal.target_amount - goal.current_amount);
  const conditionLabel = formatProductConditionDisplay(goal.product_condition);
  const cheer = getSavingsEncouragement(percent);
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
        <SavingsGoalArtwork
          colors={colors}
          goal={goal}
          imageRequestSize={170}
          size={96}
        />
        <View style={styles.progressPane}>
          <Text style={[styles.goalTitle, { color: colors.text }]}>
            {goal.title}
          </Text>
          <Text style={[styles.cheerTitle, { color: colors.primary }]}>
            {cheer.title}
          </Text>
          <Text style={[styles.cheerBody, { color: colors.textSecondary }]}>
            {cheer.body}
          </Text>
          <View style={styles.metaRow}>
            {conditionLabel ? (
              <Text
                style={[
                  styles.metaPill,
                  { backgroundColor: colors.muted, color: colors.text },
                ]}
              >
                Condition: {conditionLabel}
              </Text>
            ) : null}
            {goal.product_variant_label ? (
              <Text
                style={[
                  styles.metaPill,
                  { backgroundColor: colors.muted, color: colors.text },
                ]}
              >
                {goal.product_variant_label}
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
              style={[styles.variantButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.variantText, { color: colors.text }]}>
                Choose exact variant
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View
        style={[
          styles.progressCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
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
            <Text style={{ color: colors.primary }}>{percent}%</Text> complete
          </Text>
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
  contentRow: { flexDirection: 'row', gap: SPACING.md },
  progressPane: { flex: 1, gap: 2, minWidth: 0 },
  goalTitle: { fontSize: 16, fontWeight: '700' },
  cheerTitle: { fontSize: 14, fontWeight: '700', marginTop: 2 },
  cheerBody: { fontSize: 13, lineHeight: 18 },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginTop: SPACING.xs,
  },
  metaPill: {
    borderRadius: RADIUS.full,
    fontSize: 12,
    fontWeight: '600',
    overflow: 'hidden',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
  },
  hint: { fontSize: 14, lineHeight: 18, marginTop: SPACING.sm },
  variantButton: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: SPACING.sm,
    minHeight: 44,
  },
  variantText: { fontSize: 14, fontWeight: '600' },
  progressCard: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  amountRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'space-between',
  },
  saved: { fontSize: 14, fontWeight: '700' },
  small: { fontSize: 12, fontWeight: '500' },
  nudge: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
});

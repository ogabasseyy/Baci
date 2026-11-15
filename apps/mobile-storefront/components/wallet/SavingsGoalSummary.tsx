import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { RADIUS, SPACING } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { getSavingsEncouragement } from './get-savings-encouragement';
import { getSavingsPace } from './get-savings-pace';
import { getSavingsProgress } from './get-savings-progress';
import { getSavingsVariantPresentation } from './get-savings-variant-presentation';
import { SavingsGoalConditionArtwork } from './SavingsGoalConditionArtwork';
import { SavingsProgressMeter } from './SavingsProgressMeter';

/**
 * Top of the savings sheet: what is being saved for, how far along it is, a
 * cheer that matches the progress, and the plan's own pace (its contribution
 * and frequency).
 * The progress card shows only once something has been saved; before that,
 * only the weekly pace is shown.
 */
export function SavingsGoalSummary({
  colors,
  goal,
  onChangeDevice,
  onResolveVariant,
}: {
  colors: (typeof Colors)['light'];
  goal: WalletActiveSavingsGoal;
  /** Shown as a small "Change" pill on the card when switching is allowed. */
  onChangeDevice?: () => void;
  onResolveVariant?: () => void;
}) {
  const { displayPercent, percent } = getSavingsProgress(goal);
  const amountLeft = Math.max(0, goal.target_amount - goal.current_amount);
  const { colour, details, storage } = getSavingsVariantPresentation(
    goal.product_variant_label
  );
  const cheer = getSavingsEncouragement(percent, goal.current_amount);
  const hasProgress = goal.current_amount > 0;
  const nudge =
    goal.status === 'completed'
      ? null
      : getSavingsPace({
          contributionAmount: goal.contribution_amount,
          frequency: goal.contribution_frequency,
          maturityDate: goal.maturity_date,
          remaining: amountLeft,
        });
  return (
    <>
      <View style={[styles.goalCard, { backgroundColor: colors.muted }]}>
        <View style={styles.contentRow}>
          <SavingsGoalConditionArtwork
            colors={colors}
            goal={goal}
            imageRequestSize={128}
            size={52}
          />
          <View style={styles.progressPane}>
            <Text style={[styles.goalTitle, { color: colors.text }]}>
              {goal.title}
            </Text>
            <Text style={[styles.detail, { color: colors.textSecondary }]}>
              {`${formatNgnCurrency(goal.current_amount)} of ${formatNgnCurrency(goal.target_amount)}`}
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
                Choose the exact device variant before buying. This plan does
                not guess a model, storage or colour.
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
          {onChangeDevice ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change savings device"
              hitSlop={8}
              onPress={onChangeDevice}
              style={[
                styles.changePill,
                { backgroundColor: colors.primaryLowOpacity },
              ]}
            >
              <Ionicons
                name="swap-horizontal-outline"
                size={14}
                color={colors.primary}
              />
              <Text style={[styles.changeText, { color: colors.primary }]}>
                Change
              </Text>
            </Pressable>
          ) : null}
        </View>
        {hasProgress ? null : (
          // Nothing saved yet: a quiet bar and the weekly pace, read as one.
          <View
            accessible
            accessibilityLabel={`${formatNgnCurrency(goal.current_amount)} of ${formatNgnCurrency(goal.target_amount)} saved${nudge ? `. ${nudge.label}` : ''}`}
            style={styles.paceBlock}
          >
            <SavingsProgressMeter
              accessibilityLabel="Savings plan progress"
              colors={colors}
              height={6}
              percent={percent}
            />
            {nudge ? (
              <Text style={[styles.detail, { color: colors.textSecondary }]}>
                {nudge.short}
              </Text>
            ) : null}
          </View>
        )}
      </View>
      {hasProgress ? (
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
            Your progress
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
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 12, fontWeight: '600' },
  encouragement: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  encouragementCopy: { flex: 1, gap: 3 },
  accentDot: { width: 7, height: 7, borderRadius: 4, marginTop: 7 },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  progressPane: { flex: 1, gap: 2, minWidth: 0 },
  goalTitle: { fontSize: 16, lineHeight: 23, fontWeight: '700' },
  cheerTitle: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  cheerBody: { fontSize: 12, lineHeight: 18 },
  colourSwatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  detail: { fontSize: 12, lineHeight: 17 },
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
  goalCard: { borderRadius: RADIUS.xl, gap: SPACING.md, padding: 14 },
  paceBlock: { gap: SPACING.sm },
  changePill: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: RADIUS.full,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  changeText: { fontSize: 12, fontWeight: '600' },
});

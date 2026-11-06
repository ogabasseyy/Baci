import Ionicons from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDateTimeDisplay } from '@/components/ui/format-date-time-display';
import type Colors from '@/constants/Colors';
import { palette } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { SavingsGoalArtwork } from './SavingsGoalArtwork';
import { SavingsProgressMeter } from './SavingsProgressMeter';
import { getSavingsEncouragement } from './savings-encouragement';

type WalletSavingsPlanCardProps = {
  colors: (typeof Colors)['light'];
  /** Funded goal the database marked completed that is not yet settled. */
  awaitingSettlement?: boolean;
  goal: WalletActiveSavingsGoal;
  onOpen: () => void;
};

export function WalletSavingsPlanCard({
  awaitingSettlement = false,
  colors,
  goal,
  onOpen,
}: WalletSavingsPlanCardProps) {
  const [isActionFocused, setIsActionFocused] = useState(false);
  const actionGlowColors =
    colors.primaryForeground === palette.black
      ? ([palette.amber[600], palette.amber[400], palette.amber[600]] as const)
      : ([palette.red[700], palette.red[600], palette.red[700]] as const);
  const progress =
    goal.target_amount > 0
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round((goal.current_amount / goal.target_amount) * 100)
          )
        )
      : 0;
  const remaining = Math.max(0, goal.target_amount - goal.current_amount);
  const hasStarted = goal.current_amount > 0;
  const actionLabel = goal.selection_unresolved
    ? 'Choose exact variant'
    : awaitingSettlement
      ? 'Move your savings'
      : goal.status === 'completed'
        ? 'Start another plan'
        : goal.status === 'paused' || goal.source_mode !== 'manual'
          ? 'View plan'
          : 'Add to savings';
  const hasSavingsGlow = actionLabel === 'Add to savings';
  const heading =
    goal.status === 'completed'
      ? 'Plan complete'
      : goal.status === 'paused'
        ? 'Plan paused'
        : getSavingsEncouragement(progress).title;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.topRow}>
        <SavingsGoalArtwork
          colors={colors}
          goal={goal}
          imageRequestSize={128}
          size={86}
        />
        <View style={styles.titleBlock}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            YOUR NEXT UPGRADE
          </Text>
          <Text
            style={[styles.title, { color: colors.cardForeground }]}
            numberOfLines={2}
          >
            {goal.title}
          </Text>
          {goal.product_variant_label ? (
            <Text
              style={[styles.variant, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {goal.product_variant_label}
            </Text>
          ) : null}
          <Text style={[styles.heading, { color: colors.textSecondary }]}>
            {heading}
          </Text>
          <View style={styles.amountRow}>
            <Text style={[styles.amountLabel, { color: colors.textSecondary }]}>
              SAVED
            </Text>
            <Text
              style={[styles.savedAmount, { color: colors.cardForeground }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {formatNgnCurrency(goal.current_amount)}
              <Text
                style={[styles.targetAmount, { color: colors.textSecondary }]}
              >
                {' / '}
                {formatNgnCurrency(goal.target_amount)}
              </Text>
            </Text>
          </View>
          <SavingsProgressMeter
            accessibilityLabel="Savings plan progress"
            colors={colors}
            height={9}
            percent={progress}
          />
        </View>
      </View>
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.textSecondary }]}>
          {hasStarted
            ? `${formatNgnCurrency(remaining)} to go`
            : 'Start with your first contribution'}
        </Text>
        <Text style={[styles.footerText, { color: colors.textSecondary }]}>
          {progress}% · {formatDateTimeDisplay(goal.maturity_date, 'date')}
        </Text>
      </View>
      <View
        style={[
          styles.viewPlanGlowFrame,
          { backgroundColor: colors.primary },
          hasSavingsGlow && {
            elevation: 5,
            shadowColor: colors.primary,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.6,
            shadowRadius: 9,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel} for ${goal.title}`}
          onPress={onOpen}
          onFocus={() => setIsActionFocused(true)}
          onBlur={() => setIsActionFocused(false)}
          style={[
            styles.viewPlanButton,
            { backgroundColor: colors.primary },
            isActionFocused && {
              borderColor: colors.primaryForeground,
              borderWidth: 2,
            },
          ]}
        >
          {hasSavingsGlow ? (
            <LinearGradient
              colors={actionGlowColors}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={[styles.viewPlanGradient, { pointerEvents: 'none' }]}
            />
          ) : null}
          <Text
            style={[styles.viewPlanText, { color: colors.primaryForeground }]}
          >
            {actionLabel}
          </Text>
          <Ionicons
            name="arrow-forward"
            size={17}
            color={colors.primaryForeground}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 20,
    marginHorizontal: 16,
    marginTop: 14,
    padding: 16,
    gap: 10,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  titleBlock: { flex: 1, minWidth: 0, gap: 3 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  title: { fontSize: 18, fontWeight: '700' },
  variant: { fontSize: 12 },
  heading: { fontSize: 12, marginTop: 1 },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 5,
  },
  amountLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginRight: 3,
  },
  savedAmount: {
    fontSize: 18,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right',
  },
  targetAmount: { fontSize: 11, fontWeight: '400' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  footerText: { fontSize: 11 },
  viewPlanGlowFrame: {
    borderRadius: 24,
    marginTop: 4,
  },
  viewPlanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 24,
    overflow: 'hidden',
  },
  viewPlanGradient: {
    bottom: 0,
    borderRadius: 24,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  viewPlanText: { fontSize: 14, fontWeight: '700' },
});

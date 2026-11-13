import Ionicons from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDateTimeDisplay } from '@/components/ui/format-date-time-display';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { getSavingsProgress } from './get-savings-progress';
import { getSavingsVariantPresentation } from './get-savings-variant-presentation';
import { SavingsGoalConditionArtwork } from './SavingsGoalConditionArtwork';
import { SavingsProgressMeter } from './SavingsProgressMeter';
import type { GoalCardSetupState } from './savings/use-goal-card-setup-state';

type WalletSavingsPlanCardProps = {
  colors: (typeof Colors)['light'];
  /** Funded goal the database marked completed that is not yet settled. */
  awaitingSettlement?: boolean;
  goal: WalletActiveSavingsGoal;
  onOpen: () => void;
  /** The plan's savings wallet is not ready: show that, not "add money". */
  setupState?: GoalCardSetupState;
};

export function WalletSavingsPlanCard({
  awaitingSettlement = false,
  colors: themeColors,
  goal,
  onOpen,
  setupState = null,
}: WalletSavingsPlanCardProps) {
  const [isActionFocused, setIsActionFocused] = useState(false);
  // This is the Ogabassey app: savings actions retain its brand across appearance modes.
  const colors = {
    ...themeColors,
    primary: BRAND.primary,
    primaryForeground: BRAND.onPrimary,
    primaryLowOpacity: BRAND.primaryAlpha12,
  };
  const actionGlowColors = [
    BRAND.primaryDark,
    BRAND.primary,
    BRAND.primaryDark,
  ] as const;
  const { percent: progress } = getSavingsProgress(goal);
  const { colour, details, storage } = getSavingsVariantPresentation(
    goal.product_variant_label
  );
  const hasStarted = goal.current_amount > 0;
  const actionLabel = goal.selection_unresolved
    ? 'Choose exact variant'
    : awaitingSettlement
      ? 'Move your savings'
      : goal.status === 'completed'
        ? 'Start another plan'
        : goal.status === 'paused' ||
            goal.source_mode !== 'manual' ||
            setupState !== null
          ? 'View plan'
          : 'Add to savings';
  const hasSavingsGlow = actionLabel === 'Add to savings';
  const heading =
    goal.status === 'completed'
      ? 'Plan complete'
      : goal.status === 'paused'
        ? 'Plan paused'
        : null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.topRow}>
        <SavingsGoalConditionArtwork
          colors={colors}
          goal={goal}
          imageRequestSize={128}
          size={86}
        />
        <View style={styles.titleBlock}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            Your next upgrade
          </Text>
          <Text
            style={[styles.title, { color: colors.cardForeground }]}
            numberOfLines={2}
          >
            {goal.title}
          </Text>
          {storage ? (
            <Text
              style={[
                styles.storageTag,
                { backgroundColor: colors.muted, color: colors.text },
              ]}
            >
              {storage}
            </Text>
          ) : null}
          {details ? (
            <Text
              style={[styles.variant, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {details}
            </Text>
          ) : null}
          {heading ? (
            <Text style={[styles.heading, { color: colors.textSecondary }]}>
              {heading}
            </Text>
          ) : null}
          <View style={styles.amountRow}>
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
      <View style={styles.footer}>
        {setupState || !hasStarted ? (
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            {setupState === 'getting_ready'
              ? 'Getting your plan ready'
              : setupState === 'needs_setup'
                ? 'Finish setting up your plan'
                : 'Start with your first contribution'}
          </Text>
        ) : null}
        {goal.maturity_date ? (
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            Ends {formatDateTimeDisplay(goal.maturity_date, 'date')}
          </Text>
        ) : null}
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
  colourSwatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignSelf: 'flex-start',
    marginTop: 18,
  },
  titleBlock: { flex: 1, minWidth: 0, gap: 3 },
  eyebrow: {
    fontSize: 12,
    fontWeight: '600',
  },
  title: { fontSize: 16, fontWeight: '700' },
  storageTag: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 10,
    fontWeight: '600',
  },
  variant: { fontSize: 11 },
  heading: { fontSize: 11, marginTop: 1 },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 5,
  },
  savedAmount: {
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'left',
  },
  targetAmount: { fontSize: 10, fontWeight: '400' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  footerText: { fontSize: 10 },
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
  viewPlanText: { fontSize: 13, fontWeight: '700' },
});

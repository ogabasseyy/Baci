import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND, palette, RADIUS, SPACING } from '@/constants/Colors';
import { CheckoutStepPill } from './CheckoutStepPill';

export type CheckoutStep = 'address' | 'payment' | 'review';

const STEP_PILL_LABELS: Record<CheckoutStep, string> = {
  address: 'Delivery',
  payment: 'Payment',
  review: 'Review',
};

const ALL_STEPS: CheckoutStep[] = ['address', 'payment', 'review'];

type ColorsScheme = (typeof Colors)['light'];

interface CheckoutStepperProps {
  step: CheckoutStep;
  setStep: (step: CheckoutStep) => void;
  itemCount: number;
  colors: ColorsScheme;
  isDark: boolean;
  isPrizeSimulation?: boolean;
}

export function CheckoutStepper({
  step,
  setStep,
  itemCount,
  colors,
  isDark,
  isPrizeSimulation = false,
}: CheckoutStepperProps) {
  const steps: readonly CheckoutStep[] = isPrizeSimulation
    ? ['address', 'review']
    : ALL_STEPS;
  const currentIndex = Math.max(0, steps.indexOf(step));

  return (
    <View style={styles.stepIndicator}>
      <View style={styles.stepHeaderRow}>
        <Text style={[styles.stepTitle, { color: colors.text }]}>Checkout</Text>
        <View
          style={[
            styles.stepBadge,
            {
              backgroundColor: isDark
                ? 'rgba(217, 59, 48, 0.16)'
                : palette.red[50],
            },
          ]}
        >
          <Ionicons name="checkmark" size={12} color={BRAND.primary} />
          <Text style={[styles.stepBadgeText, { color: BRAND.primary }]}>
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </Text>
        </View>
      </View>
      <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>
        Step {currentIndex + 1} of {steps.length}
      </Text>
      <View
        style={[
          styles.stepProgress,
          {
            backgroundColor: isDark
              ? 'rgba(148, 163, 184, 0.16)'
              : palette.gray[200],
          },
        ]}
      >
        <View
          style={[
            styles.stepProgressActive,
            { width: `${((currentIndex + 1) / steps.length) * 100}%` },
          ]}
        />
      </View>
      <View style={styles.stepPills}>
        {steps.map((s, index) => {
          const status =
            index < currentIndex
              ? 'completed'
              : index === currentIndex
                ? 'current'
                : 'upcoming';
          return (
            <CheckoutStepPill
              key={s}
              colors={colors}
              isDark={isDark}
              label={STEP_PILL_LABELS[s]}
              number={index + 1}
              onPress={status === 'completed' ? () => setStep(s) : undefined}
              status={status}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stepIndicator: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
  },
  stepHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  stepBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.red[50],
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
  },
  stepBadgeText: {
    fontSize: 12,
    color: BRAND.primary,
    fontWeight: '600',
  },
  stepSubtitle: {
    fontSize: 13,
    marginBottom: SPACING.sm,
  },
  stepProgress: {
    height: 6,
    borderRadius: 999,
    backgroundColor: palette.gray[200],
    overflow: 'hidden',
    marginBottom: SPACING.sm,
  },
  stepProgressActive: {
    height: 6,
    backgroundColor: BRAND.primary,
  },
  stepPills: {
    flexDirection: 'row',
    gap: 8,
  },
});

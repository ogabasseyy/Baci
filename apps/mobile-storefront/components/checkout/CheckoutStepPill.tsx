import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND, palette, RADIUS } from '@/constants/Colors';

type ColorsScheme = (typeof Colors)['light'];

export type CheckoutStepPillStatus = 'completed' | 'current' | 'upcoming';

interface CheckoutStepPillProps {
  colors: ColorsScheme;
  isDark: boolean;
  label: string;
  number: number;
  /** Stable step id for testIDs, so they do not shift with the visible steps. */
  stepKey: string;
  /** Only completed steps navigate, so only they receive a handler. */
  onPress?: () => void;
  status: CheckoutStepPillStatus;
}

/**
 * One chip in the checkout stepper. Only completed steps are buttons (they
 * take the shopper back). The current and upcoming steps are plain labels:
 * upcoming chips get a dashed outline and no fill so they do not read as
 * tappable, and screen readers hear "not yet available".
 */
export function CheckoutStepPill({
  colors,
  isDark,
  label,
  number,
  onPress,
  status,
  stepKey,
}: CheckoutStepPillProps) {
  const isCurrent = status === 'current';
  const isCompleted = status === 'completed';
  const isHighlighted = isCurrent || isCompleted;

  const pillStyle = [
    styles.stepPill,
    {
      backgroundColor: isCurrent
        ? isDark
          ? 'rgba(217, 59, 48, 0.16)'
          : palette.red[50]
        : isCompleted
          ? colors.card
          : 'transparent',
      borderColor: isHighlighted
        ? BRAND.primary
        : isDark
          ? 'rgba(255, 255, 255, 0.16)'
          : colors.border,
      borderStyle: isHighlighted ? ('solid' as const) : ('dashed' as const),
    },
  ];

  const content = (
    <>
      <View
        style={[
          styles.stepPillDot,
          {
            backgroundColor: isHighlighted
              ? BRAND.primary
              : isDark
                ? 'rgba(148, 163, 184, 0.22)'
                : palette.gray[200],
          },
        ]}
      >
        {isCompleted ? (
          <Ionicons name="checkmark" size={12} color="#FFFFFF" />
        ) : (
          <Text
            style={[
              styles.stepPillNumber,
              { color: isCurrent ? '#FFFFFF' : colors.textSecondary },
            ]}
          >
            {number}
          </Text>
        )}
      </View>
      <Text
        style={[
          styles.stepPillText,
          {
            color: isCurrent
              ? isDark
                ? '#FDECEA'
                : BRAND.primary
              : isCompleted
                ? colors.text
                : colors.textSecondary,
          },
        ]}
      >
        {label}
      </Text>
    </>
  );

  if (isCompleted) {
    // A completed step is always a button; without a handler it is disabled.
    return (
      <Pressable
        accessibilityLabel={
          onPress
            ? `Go to ${label} step, completed`
            : `${label} step, completed`
        }
        accessibilityRole="button"
        accessibilityState={{ disabled: !onPress }}
        disabled={!onPress}
        onPress={onPress}
        style={pillStyle}
        testID={`checkout-step-pill-${stepKey}`}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      accessible
      accessibilityLabel={`${label} step, ${isCurrent ? 'current' : 'not yet available'}`}
      style={pillStyle}
      testID={`checkout-step-pill-${stepKey}`}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  stepPill: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS.xl,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  stepPillDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepPillNumber: {
    fontSize: 12,
    fontWeight: '700',
  },
  stepPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
});

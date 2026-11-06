import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import type Colors from '@/constants/Colors';
import { RADIUS, SPACING, withAlpha } from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { useReduceMotion } from './use-reduce-motion';
import type { SavingsCelebration } from './use-savings-celebration';

/** Short success moment shown after money was added to a goal. */
export function SavingsCelebrationCard({
  celebration,
  colors,
}: {
  celebration: SavingsCelebration;
  colors: (typeof Colors)['light'];
}) {
  const reduceMotion = useReduceMotion();
  const enter = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      enter.setValue(1);
      return;
    }
    Animated.timing(enter, {
      duration: 240,
      easing: Easing.bezier(0.23, 1, 0.32, 1),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [enter, reduceMotion]);
  const reached = celebration.percent >= 100;
  const message = reached
    ? `Goal reached! ${formatNgnCurrency(celebration.added)} added. You did it.`
    : `Nice! ${formatNgnCurrency(celebration.added)} added. You're ${celebration.percent}% there.`;
  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.card,
        {
          opacity: enter,
          transform: [
            {
              translateY: enter.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
          ],
        },
        {
          backgroundColor: withAlpha(colors.success, 0.12),
          borderColor: withAlpha(colors.success, 0.4),
        },
      ]}
    >
      <Ionicons
        name={reached ? 'trophy' : 'checkmark-circle'}
        size={26}
        color={colors.success}
      />
      <Text style={[styles.text, { color: colors.text }]}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  text: { flex: 1, fontSize: 15, fontWeight: '700' },
});

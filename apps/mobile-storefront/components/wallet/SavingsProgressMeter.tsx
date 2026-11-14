import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { RADIUS } from '@/constants/Colors';
import { useReduceMotion } from './use-reduce-motion';

const MILESTONES = [25, 50, 75] as const;

/**
 * Progress bar for a savings goal. The fill glides to a new value when it
 * changes (instantly when the device asks for reduced motion) and faint ticks
 * mark the 25 / 50 / 75 percent milestones.
 */
export function SavingsProgressMeter({
  accessibilityLabel,
  colors,
  height = 12,
  percent,
}: {
  accessibilityLabel: string;
  colors: (typeof Colors)['light'];
  height?: number;
  percent: number;
}) {
  const reduceMotion = useReduceMotion();
  const width = useRef(new Animated.Value(percent)).current;
  useEffect(() => {
    if (reduceMotion !== false) {
      width.setValue(percent);
      return;
    }
    // Width cannot run on the native driver; this bar is tiny and rarely moves.
    Animated.timing(width, {
      duration: 450,
      easing: Easing.bezier(0.23, 1, 0.32, 1),
      toValue: percent,
      useNativeDriver: false,
    }).start();
  }, [percent, reduceMotion, width]);
  const fillWidth = width.interpolate({
    extrapolate: 'clamp',
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });
  const complete = percent >= 100;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ max: 100, min: 0, now: percent }}
      style={[
        styles.track,
        { backgroundColor: colors.primaryLowOpacity, height },
      ]}
    >
      <Animated.View
        style={[
          styles.fill,
          { backgroundColor: complete ? colors.success : colors.primary },
          { width: fillWidth },
        ]}
      />
      {MILESTONES.map((mark) => (
        <View
          key={mark}
          style={[
            styles.tick,
            {
              backgroundColor:
                percent >= mark ? colors.primaryForeground : colors.border,
              left: `${mark}%`,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { borderRadius: RADIUS.full, overflow: 'hidden' },
  fill: { borderRadius: RADIUS.full, height: '100%' },
  tick: {
    bottom: 2,
    position: 'absolute',
    top: 2,
    width: 2,
    opacity: 0.55,
    pointerEvents: 'none',
  },
});

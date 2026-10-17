import { useEffect } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { palette } from '@/constants/Colors';
import { SEASONAL } from '@/lib/seasonal';
import { useThemeStore } from '@/stores/theme-store';
import { getSnowflakeShadowStyle } from './SnowEffect.shadows';

const NUM_SNOWFLAKES = 40; // Optimized for performance
// Static decorative list: positional ids are stable keys because the
// flakes never reorder (module scope — allocated once, not per render).
const SNOWFLAKE_IDS: number[] = Array.from(
  { length: NUM_SNOWFLAKES },
  (_, position) => position
);
const snowflakeShadowStyle = getSnowflakeShadowStyle(
  Platform.OS === 'web' ? 'web' : 'native'
);

/**
 * Individual Snowflake with Parallax properties
 * 2026 Best Practice: Use seeded randomness based on index to ensure stable values
 * across re-renders and prevent animation value recreation
 *
 * M31 fix: Removed React.memo — React Compiler handles memoization (ADR-004).
 */
function Snowflake({
  index,
  color,
  screenWidth,
  screenHeight,
}: {
  index: number;
  color: string;
  screenWidth: number;
  screenHeight: number;
}) {
  // Use index to determine "layer" (0 = back, 1 = mid, 2 = front)
  const layer = index % 3;

  // Parallax properties based on layer
  const scale = 0.5 + layer * 0.4; // 0.5, 0.9, 1.3
  const speedMultiplier = 0.7 + layer * 0.3; // Back moves slower

  // 2026 Best Practice: Use index-based seeded values instead of Math.random()
  // This ensures stable values across re-renders and prevents animation recreation
  const seed = (index * 9301 + 49297) % 233280;
  // M31 fix: Removed useCallback — React Compiler handles memoization (ADR-004)
  const seededRandom = (offset: number) => ((seed + offset) % 233280) / 233280;

  // M31 fix: Removed useMemo wrappers — React Compiler handles memoization (ADR-004)
  const xPosition = seededRandom(0) * screenWidth;
  const startY = -seededRandom(1) * 200;
  const duration = (6000 + seededRandom(2) * 4000) / speedMultiplier;
  const delay = seededRandom(3) * 8000;
  const size = (3 + seededRandom(4) * 4) * scale;

  // 2026 Best Practice: Initialize shared values with stable starting values
  const translateY = useSharedValue(startY);
  const opacity = useSharedValue(0.4 + layer * 0.2);

  useEffect(() => {
    translateY.set(
      withDelay(
        delay,
        withRepeat(
          withTiming(screenHeight + 100, {
            duration: duration,
            easing: Easing.bezier(0.45, 0, 0.55, 1), // Smoother falling curve
          }),
          -1
        )
      )
    );

    return () => {
      cancelAnimation(translateY);
    };
  }, [delay, duration, translateY, screenHeight]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }, { scale: scale }],
    opacity: opacity.get(),
  }));

  return (
    <Animated.View
      style={[
        styles.snowflake,
        snowflakeShadowStyle,
        {
          left: xPosition,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

/**
 * SnowEffect - Elite 2026 Implementation
 */
export function SnowEffect() {
  const theme = useThemeStore((state) => state.theme);
  // M31 fix: Removed useMemo — React Compiler handles memoization (ADR-004)
  const tokens = SEASONAL.getTokens(theme);
  // M34 fix: Use useWindowDimensions() hook instead of stale Dimensions.get('window')
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const reducedMotion = useReducedMotion();

  if (!tokens.isSanta || reducedMotion) return null;

  return (
    <View style={styles.container}>
      {SNOWFLAKE_IDS.map((id) => (
        <Snowflake
          key={id}
          index={id}
          color={tokens.snowColor ?? palette.white}
          screenWidth={screenWidth}
          screenHeight={screenHeight}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
    elevation: 9999,
    pointerEvents: 'none',
  },
  snowflake: {
    position: 'absolute',
    top: 0,
  },
});

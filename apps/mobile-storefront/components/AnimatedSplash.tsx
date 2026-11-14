import { Image } from 'expo-image';
import { type ReactNode, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { BRAND, palette, withAlpha } from '@/constants/Colors';

import iconImage from '../assets/images/icon.png';

type AnimatedSplashProps = {
  isReady: boolean;
  isVisible?: boolean;
  onAnimationEnd: () => void;
  children: ReactNode;
};

/**
 * Full-screen animated splash overlay using Reanimated (worklet-driven).
 * Children render behind the overlay and are ready when it fades.
 * Blocks touch through style.pointerEvents until isReady, then lets taps pass
 * through the fading overlay.
 */
export function AnimatedSplash({
  isReady,
  isVisible = true,
  onAnimationEnd,
  children,
}: AnimatedSplashProps) {
  // SharedValue (not useRef) so the guard is accessible inside worklets
  const hasExited = useSharedValue(0);
  const logoScale = useSharedValue(1);
  const shimmerOpacity = useSharedValue(0);
  const containerOpacity = useSharedValue(1);

  // Shimmer pulse: fade in then loop
  useEffect(() => {
    if (!isVisible) return;

    shimmerOpacity.set(
      withDelay(
        300,
        withTiming(0.6, { duration: 400 }, () => {
          shimmerOpacity.set(
            withRepeat(
              withSequence(
                withTiming(0.3, {
                  duration: 800,
                  easing: Easing.inOut(Easing.ease),
                }),
                withTiming(0.6, {
                  duration: 800,
                  easing: Easing.inOut(Easing.ease),
                })
              ),
              -1
            )
          );
        })
      )
    );
  }, [isVisible, shimmerOpacity]);

  // Exit animation when app is ready
  useEffect(() => {
    if (!isVisible || !isReady || hasExited.get() === 1) return;

    // Stop the infinite shimmer loop so the worklet is released cleanly
    cancelAnimation(shimmerOpacity);

    logoScale.set(
      withTiming(1.1, {
        duration: 300,
        easing: Easing.in(Easing.cubic),
      })
    );

    containerOpacity.set(
      withDelay(
        100,
        withTiming(
          0,
          { duration: 400, easing: Easing.in(Easing.cubic) },
          () => {
            if (hasExited.get() === 0) {
              hasExited.set(1);
              scheduleOnRN(onAnimationEnd);
            }
          }
        )
      )
    );
  }, [
    isReady,
    isVisible,
    logoScale,
    containerOpacity,
    onAnimationEnd,
    hasExited,
    shimmerOpacity,
  ]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.get(),
  }));

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.get() }],
  }));

  const shimmerStyle = useAnimatedStyle(() => ({
    opacity: shimmerOpacity.get(),
  }));

  return (
    <View style={styles.wrapper}>
      {children}
      {isVisible ? (
        <Animated.View
          style={[
            styles.container,
            containerStyle,
            { pointerEvents: isReady ? 'none' : 'auto' },
          ]}
        >
          <Animated.View style={[styles.logoContainer, logoStyle]}>
            <Image
              source={iconImage}
              style={styles.logo}
              contentFit="contain"
            />
          </Animated.View>

          <Animated.View style={[styles.shimmerBar, shimmerStyle]}>
            <View style={styles.shimmerFill} />
          </Animated.View>

          <Animated.Text style={[styles.tagline, shimmerStyle]}>
            Buy Now, Pay Later
          </Animated.Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: palette.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 140,
    height: 140,
    borderRadius: 28,
  },
  shimmerBar: {
    marginTop: 32,
    width: 48,
    height: 3,
    borderRadius: 2,
    backgroundColor: withAlpha(palette.white, 0.1),
    overflow: 'hidden',
  },
  shimmerFill: {
    width: '100%',
    height: '100%',
    backgroundColor: BRAND.primary,
    borderRadius: 2,
  },
  tagline: {
    marginTop: 16,
    fontSize: 14,
    fontWeight: '500',
    color: withAlpha(palette.white, 0.6),
    letterSpacing: 1,
  },
});

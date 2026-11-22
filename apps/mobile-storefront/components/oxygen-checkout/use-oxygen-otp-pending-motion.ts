import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing } from 'react-native';
export function useOxygenOtpPendingMotion(active: boolean) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let live = true;
    let reduced = true;
    let loop: Animated.CompositeAnimation | undefined;
    function sync() {
      loop?.stop();
      progress.setValue(0);
      if (
        !live ||
        !active ||
        reduced ||
        AppState.currentState === 'background' ||
        AppState.currentState === 'inactive'
      )
        return;
      loop = Animated.loop(
        Animated.timing(progress, {
          toValue: 1,
          duration: 1100,
          easing: Easing.linear,
          useNativeDriver: true,
          isInteraction: false,
        })
      );
      loop.start();
    }
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => true)
      .then((value) => {
        reduced = value;
        sync();
      });
    const app = AppState.addEventListener('change', sync);
    const motion = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (value) => {
        reduced = value;
        sync();
      }
    );
    return () => {
      live = false;
      loop?.stop();
      app.remove();
      motion.remove();
    };
  }, [active, progress]);
  return progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
}

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
/** Server confirmation alone authorizes success; fallback settles interrupted motion. */
export function useOxygenOtpAnimation(confirmed: boolean, scopeKey: string) {
  const progress = useRef(new Animated.Value(0)).current;
  const [settled, setSettled] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scope changes must invalidate transient state and animations.
  useEffect(() => {
    let live = true;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    let animation: Animated.CompositeAnimation | undefined;
    setSettled(false);
    progress.setValue(0);
    if (confirmed) {
      void AccessibilityInfo.isReduceMotionEnabled()
        .catch(() => true)
        .then((reduced) => {
          if (!live) return;
          const finish = () => {
            if (live) {
              progress.setValue(1);
              setSettled(true);
            }
          };
          if (reduced) {
            finish();
            return;
          }
          animation = Animated.timing(progress, {
            toValue: 1,
            duration: 220,
            useNativeDriver: true,
          });
          animation.start(finish);
          fallback = setTimeout(finish, 400);
        });
    }
    return () => {
      live = false;
      animation?.stop();
      if (fallback) clearTimeout(fallback);
    };
  }, [confirmed, scopeKey, progress]);
  return { progress, settled: confirmed && settled };
}

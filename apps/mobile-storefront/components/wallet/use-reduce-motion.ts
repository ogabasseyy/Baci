import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Null until resolved; true for reduced motion, false only when motion is allowed. */
export function useReduceMotion(): boolean | null {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => {
        if (active) setReduceMotion(true);
      });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

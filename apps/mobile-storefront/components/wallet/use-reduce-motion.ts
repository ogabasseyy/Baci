import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Null until resolved; true for reduced motion, false only when motion is allowed. */
export function useReduceMotion(): boolean | null {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    let preferenceChanged = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active && !preferenceChanged) setReduceMotion(enabled);
      })
      .catch(() => {
        if (active && !preferenceChanged) setReduceMotion(true);
      });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        preferenceChanged = true;
        setReduceMotion(enabled);
      }
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

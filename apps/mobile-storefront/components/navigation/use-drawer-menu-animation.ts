import { useEffect, useState } from 'react';
import {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const ANIMATION_DURATION = 300;

/**
 * Drives the drawer slide/backdrop animation and reports animation
 * completion to the drawer store. Ad ownership keys off the fully-open
 * latch (not isOpen, which flips when an animation starts) so the drawer
 * slot mounts only once visible and background slots resume only after the
 * close animation lands.
 */
export function useDrawerMenuAnimation({
  drawerWidth,
  isOpen,
  setFullyOpen,
}: {
  drawerWidth: number;
  isOpen: boolean;
  setFullyOpen: (fullyOpen: boolean) => void;
}) {
  const [shouldRenderPattern, setShouldRenderPattern] = useState(isOpen);
  const translateX = useSharedValue(-drawerWidth);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (isOpen) {
      setShouldRenderPattern(true);
      translateX.set(
        withTiming(
          0,
          {
            duration: ANIMATION_DURATION,
            easing: Easing.out(Easing.cubic),
          },
          (finished) => {
            if (finished) scheduleOnRN(setFullyOpen, true);
          }
        )
      );
      backdropOpacity.set(withTiming(1, { duration: ANIMATION_DURATION }));
    } else {
      translateX.set(
        withTiming(
          -drawerWidth,
          {
            duration: ANIMATION_DURATION,
            easing: Easing.in(Easing.cubic),
          },
          (finished) => {
            if (!finished) return;
            scheduleOnRN(setShouldRenderPattern, false);
            scheduleOnRN(setFullyOpen, false);
          }
        )
      );
      backdropOpacity.set(withTiming(0, { duration: ANIMATION_DURATION }));
    }
  }, [isOpen, translateX, backdropOpacity, setFullyOpen, drawerWidth]);

  const drawerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }],
  }));
  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.get(),
  }));

  return {
    backdropAnimatedStyle,
    backdropOpacity,
    drawerAnimatedStyle,
    shouldRenderPattern,
    translateX,
  };
}

export type DrawerMenuAnimation = ReturnType<typeof useDrawerMenuAnimation>;

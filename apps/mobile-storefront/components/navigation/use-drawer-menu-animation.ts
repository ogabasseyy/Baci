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
 * Drives the drawer slide/backdrop animation and reports coverage to the
 * drawer store. The drawer slot mounts on the fully-open latch (set only
 * by a completed opening) while background slots suspend on the covering
 * latch (open-start through close-complete, including interrupted
 * openings).
 */
export function useDrawerMenuAnimation({
  drawerWidth,
  isOpen,
  setCovering,
  setFullyOpen,
}: {
  drawerWidth: number;
  isOpen: boolean;
  setCovering: (covering: boolean) => void;
  setFullyOpen: (fullyOpen: boolean) => void;
}) {
  const [shouldRenderPattern, setShouldRenderPattern] = useState(isOpen);
  const translateX = useSharedValue(-drawerWidth);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (isOpen) {
      // Coverage starts with the opening slide (not its completion) so an
      // interrupted opening still suspends background slots through the
      // close animation.
      setCovering(true);
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
            scheduleOnRN(setCovering, false);
          }
        )
      );
      backdropOpacity.set(withTiming(0, { duration: ANIMATION_DURATION }));
    }
  }, [
    isOpen,
    translateX,
    backdropOpacity,
    setCovering,
    setFullyOpen,
    drawerWidth,
  ]);

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

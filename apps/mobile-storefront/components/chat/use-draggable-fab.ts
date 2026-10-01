import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import {
  cancelAnimation,
  runOnJS,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { getOptionalGestureHandlerRuntime } from '@/lib/optional-gesture-handler';
import {
  DISMISS_BOTTOM_OFFSET,
  DISMISS_RADIUS,
  EDGE_MARGIN,
  FAB_SIZE,
  GESTURE_MAX_TAP_DISTANCE,
  GESTURE_MIN_DISTANCE,
  TOP_CLAMP,
  VELOCITY_PROJECTOR_X,
  VELOCITY_PROJECTOR_Y,
} from './constants';
import {
  getAnchoredFabTranslationX,
  getClampedFabTranslationY,
} from './use-draggable-fab-position';

// Define completely static, immutable haptic trigger outside the hook
const triggerHaptic = (style: Haptics.ImpactFeedbackStyle) => {
  if (Platform.OS === 'ios') {
    Haptics.impactAsync(style).catch(() => undefined);
  }
};

const noop = () => undefined;

// Resolve the optional gesture-handler hooks once at module scope. The
// runtime is a cached singleton, so the hook identities are static across
// renders — required by the Rules of Hooks and React Compiler memoization.
const { usePanGesture, useSimultaneousGestures, useTapGesture } =
  getOptionalGestureHandlerRuntime();

export function useDraggableFab(
  bottomOffset: number,
  onDismiss?: () => void,
  onPress?: () => void
) {
  const [isDragging, setIsDragging] = useState(false);
  const [isOverDismissZone, setIsOverDismissZone] = useState(false);
  const [isOnRight, setIsOnRight] = useState(true);
  const handleDismissJS = onDismiss ?? noop;
  const handlePressJS = onPress ?? noop;

  // Translation values relative to starting styled location
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Reanimated boolean latch for haptic boundary transitions
  const hapticTriggered = useSharedValue(false);

  // Track coordinates when the gesture begins
  const contextX = useSharedValue(0);
  const contextY = useSharedValue(0);

  // Track viewport dimensions dynamically
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const windowWidthSV = useSharedValue(windowWidth);
  const windowHeightSV = useSharedValue(windowHeight);
  const bottomOffsetSV = useSharedValue(bottomOffset);
  const previousLayoutRef = useRef({ bottomOffset, windowHeight, windowWidth });

  useEffect(() => {
    const previousLayout = previousLayoutRef.current;

    windowWidthSV.set(windowWidth);
    windowHeightSV.set(windowHeight);
    bottomOffsetSV.set(bottomOffset);

    const hasLayoutChanged =
      previousLayout.windowWidth !== windowWidth ||
      previousLayout.windowHeight !== windowHeight ||
      previousLayout.bottomOffset !== bottomOffset;

    if (hasLayoutChanged && !isDragging) {
      const anchoredTranslationX = getAnchoredFabTranslationX(
        windowWidth,
        isOnRight
      );
      const clampedTranslationY = getClampedFabTranslationY(
        previousLayout.windowHeight - previousLayout.bottomOffset - FAB_SIZE,
        windowHeight,
        bottomOffset,
        translateY.get()
      );
      translateX.set(
        withSpring(anchoredTranslationX, { damping: 15, stiffness: 120 })
      );
      translateY.set(
        withSpring(clampedTranslationY, { damping: 15, stiffness: 120 })
      );
    }

    previousLayoutRef.current = { bottomOffset, windowHeight, windowWidth };
  }, [
    bottomOffset,
    bottomOffsetSV,
    isDragging,
    isOnRight,
    translateX,
    translateY,
    windowHeight,
    windowHeightSV,
    windowWidth,
    windowWidthSV,
  ]);

  const panGesture = usePanGesture({
    minDistance: GESTURE_MIN_DISTANCE,
    onBegin: () => {
      'worklet';
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      contextX.set(translateX.get());
      contextY.set(translateY.get());

      runOnJS(setIsDragging)(true);
      runOnJS(triggerHaptic)(Haptics.ImpactFeedbackStyle.Light);
    },
    onUpdate: (event) => {
      'worklet';
      translateX.set(contextX.get() + event.translationX);
      translateY.set(contextY.get() + event.translationY);

      // Absolute coordinates calculation using shared values
      const currentWidth = windowWidthSV.get();
      const currentHeight = windowHeightSV.get();
      const currentBottomOffset = bottomOffsetSV.get();

      const startX = currentWidth - FAB_SIZE - EDGE_MARGIN;
      const startY = currentHeight - currentBottomOffset - FAB_SIZE;

      const absoluteX = startX + translateX.get();
      const absoluteY = startY + translateY.get();

      const fabCenterX = absoluteX + FAB_SIZE / 2;
      const fabCenterY = absoluteY + FAB_SIZE / 2;
      const dismissCenterX = currentWidth / 2;
      const dismissCenterY = currentHeight - DISMISS_BOTTOM_OFFSET;

      const dx = fabCenterX - dismissCenterX;
      const dy = fabCenterY - dismissCenterY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const isOver = distance < DISMISS_RADIUS;

      // Haptic boundary latch logic
      if (isOver && !hapticTriggered.get()) {
        hapticTriggered.set(true);
        runOnJS(setIsOverDismissZone)(true);
        runOnJS(triggerHaptic)(Haptics.ImpactFeedbackStyle.Light);
      } else if (!isOver && hapticTriggered.get()) {
        hapticTriggered.set(false);
        runOnJS(setIsOverDismissZone)(false);
      }
    },
    onDeactivate: (event) => {
      'worklet';
      runOnJS(setIsDragging)(false);

      const currentWidth = windowWidthSV.get();
      const currentHeight = windowHeightSV.get();
      const currentBottomOffset = bottomOffsetSV.get();

      const startX = currentWidth - FAB_SIZE - EDGE_MARGIN;
      const startY = currentHeight - currentBottomOffset - FAB_SIZE;

      const absoluteX = startX + translateX.get();
      const absoluteY = startY + translateY.get();

      const isOverDismiss = hapticTriggered.get();
      hapticTriggered.set(false);
      runOnJS(setIsOverDismissZone)(false);

      if (isOverDismiss) {
        translateX.set(withSpring(0, { damping: 15, stiffness: 120 }));
        translateY.set(withSpring(0, { damping: 15, stiffness: 120 }));
        runOnJS(setIsOnRight)(true);
        runOnJS(triggerHaptic)(Haptics.ImpactFeedbackStyle.Medium);
        runOnJS(handleDismissJS)();
        return;
      }

      // Snap to nearest horizontal edge
      const leftBound = EDGE_MARGIN;
      const rightBound = startX;

      const snapX = absoluteX + event.velocityX * VELOCITY_PROJECTOR_X;
      const targetXAbsolute =
        snapX + FAB_SIZE / 2 < currentWidth / 2 ? leftBound : rightBound;

      // Clamp vertical bounds
      const minY = TOP_CLAMP;
      const maxY = currentHeight - currentBottomOffset - FAB_SIZE;
      let targetYAbsolute = absoluteY + event.velocityY * VELOCITY_PROJECTOR_Y;
      targetYAbsolute = Math.max(minY, Math.min(targetYAbsolute, maxY));

      const targetTranslationX = targetXAbsolute - startX;
      const targetTranslationY = targetYAbsolute - startY;

      const isRight = targetXAbsolute === rightBound;
      runOnJS(setIsOnRight)(isRight);
      runOnJS(triggerHaptic)(Haptics.ImpactFeedbackStyle.Medium);

      translateX.set(
        withSpring(targetTranslationX, { damping: 15, stiffness: 120 })
      );
      translateY.set(
        withSpring(targetTranslationY, { damping: 15, stiffness: 120 })
      );
    },
    onFinalize: () => {
      'worklet';
      hapticTriggered.set(false);
      runOnJS(setIsDragging)(false);
      runOnJS(setIsOverDismissZone)(false);
    },
  });

  const tapGesture = useTapGesture({
    maxDistance: GESTURE_MAX_TAP_DISTANCE,
    onActivate: () => {
      'worklet';
      runOnJS(triggerHaptic)(Haptics.ImpactFeedbackStyle.Medium);
      runOnJS(handlePressJS)();
    },
  });

  const composedGesture = useSimultaneousGestures(panGesture, tapGesture);

  return {
    composedGesture,
    translateX,
    translateY,
    isDragging,
    isOverDismissZone,
    isOnRight,
  };
}

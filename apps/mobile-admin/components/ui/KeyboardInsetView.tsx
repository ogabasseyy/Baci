import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, {
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';

interface KeyboardInsetViewProps {
  children: ReactNode;
  /** Spacing once the keyboard is fully up (usually small). */
  opened: number;
  /** Which spacing eases: padding inside the view, or its offset from the bottom. */
  property?: 'paddingBottom' | 'bottom';
  /** Spacing with the keyboard down (usually the safe area). */
  resting: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A view whose bottom spacing eases from `resting` to `opened` as the keyboard
 * rises, frame by frame, so nothing is left floating a safe-area's height above
 * the keyboard once it is up.
 */
export function KeyboardInsetView({
  children,
  opened,
  property = 'paddingBottom',
  resting,
  style,
}: KeyboardInsetViewProps) {
  const { progress } = useReanimatedKeyboardAnimation();
  const eased = useAnimatedStyle(() => {
    const value = interpolate(progress.value, [0, 1], [resting, opened]);
    return property === 'bottom' ? { bottom: value } : { paddingBottom: value };
  });
  return <Animated.View style={[style, eased]}>{children}</Animated.View>;
}

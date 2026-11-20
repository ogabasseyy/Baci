import { Platform, useWindowDimensions } from 'react-native';
import {
  Extrapolate,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type Colors from '@/constants/Colors';
import { useKeyboard } from '@/hooks/use-keyboard';

type ColorsScheme = (typeof Colors)['light'];

export function useProductDetailAnimations(colors: ColorsScheme) {
  const { height, width } = useWindowDimensions();
  const { isKeyboardVisible, keyboardHeight } = useKeyboard();
  // Android reports the window above the keyboard in adjustResize mode.
  const availableHeight =
    Platform.OS === 'android' && isKeyboardVisible
      ? height + keyboardHeight
      : height;
  const headerHeight = Math.min(width, availableHeight);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.set(event.contentOffset.y);
    },
  });
  const imageAnimatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      scrollY.get(),
      [-100, 0],
      [1.2, 1],
      Extrapolate.CLAMP
    );
    const translateY = interpolate(
      scrollY.get(),
      [0, headerHeight],
      [0, -headerHeight * 0.2],
      Extrapolate.CLAMP
    );
    return { transform: [{ scale }, { translateY }] };
  });
  const headerAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: colors.card,
    opacity: interpolate(
      scrollY.get(),
      [headerHeight * 0.5, headerHeight * 0.8],
      [0, 1],
      Extrapolate.CLAMP
    ),
  }));
  const backButtonAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor:
      scrollY.get() > headerHeight * 0.7
        ? withTiming('transparent')
        : withTiming('rgba(0,0,0,0.3)'),
  }));

  return {
    backButtonAnimatedStyle,
    headerAnimatedStyle,
    headerHeight,
    imageAnimatedStyle,
    onScroll,
  };
}

import { useIsFocused } from 'expo-router/react-navigation';
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

export function useCheckoutCtaAnimation(isProcessing: boolean, duration = 800) {
  const isFocused = useIsFocused();
  const ctaArrowTranslateX = useSharedValue(0);

  useEffect(() => {
    const stop = () => {
      cancelAnimation(ctaArrowTranslateX);
      ctaArrowTranslateX.set(0);
    };
    const sync = (state: AppStateStatus) => {
      if (isProcessing || !isFocused || state !== 'active') {
        stop();
        return;
      }
      // A short attention cue must not keep Fabric committing frames for the
      // entire checkout session, including time spent in a provider WebView.
      ctaArrowTranslateX.set(
        withRepeat(
          withSequence(
            withTiming(6, { duration }),
            withTiming(0, { duration })
          ),
          3,
          false
        )
      );
    };
    sync(AppState.currentState);
    const subscription = AppState.addEventListener('change', sync);
    return () => {
      subscription.remove();
      stop();
    };
  }, [ctaArrowTranslateX, duration, isFocused, isProcessing]);

  return useAnimatedStyle(() => ({
    transform: [{ translateX: ctaArrowTranslateX.get() }],
  }));
}

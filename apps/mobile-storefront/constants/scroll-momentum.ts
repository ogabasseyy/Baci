import { Platform } from 'react-native';

// React Native's normal rates differ by OS. Reduce each platform's damping
// by about 5% for a modestly longer flick, preserving direct finger tracking.
export const SEARCH_SCROLL_DECELERATION_RATE = Platform.select<
  number | 'normal'
>({
  ios: 0.9981,
  android: 0.98575,
  default: 'normal' as const,
});

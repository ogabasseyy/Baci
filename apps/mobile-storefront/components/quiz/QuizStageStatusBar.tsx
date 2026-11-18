import { useIsFocused } from 'expo-router';
import { StatusBar } from 'react-native';

/**
 * Light status-bar icons for the dark quiz stage. Rendered only while the
 * quiz route is the focused screen: the route stays mounted when another
 * screen (sign-in, a product) is pushed on top, and that screen must keep
 * the app's own status-bar style.
 */
export function QuizStageStatusBar() {
  const isFocused = useIsFocused();
  return isFocused ? <StatusBar barStyle="light-content" /> : null;
}

/**
 * Haptic Feedback Hook
 * Provides consistent haptic feedback across the app
 *
 * 2026 Best Practice: Centralized haptic feedback for UX consistency
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Haptic feedback types for different interactions
 */
export type HapticType =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'success'
  | 'warning'
  | 'error'
  | 'selection';

/**
 * Trigger haptic feedback with error handling
 * Only works on iOS; Android support is limited
 */
export function triggerHaptic(type: HapticType = 'light'): void {
  // Only trigger on iOS for consistent behavior
  if (Platform.OS !== 'ios') return;

  let pending: Promise<void> | undefined;
  try {
    switch (type) {
      case 'light':
        pending = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'medium':
        pending = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'heavy':
        pending = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case 'success':
        pending = Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success
        );
        break;
      case 'warning':
        pending = Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Warning
        );
        break;
      case 'error':
        pending = Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error
        );
        break;
      case 'selection':
        pending = Haptics.selectionAsync();
        break;
      default:
        pending = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  } catch {
    // Silently fail if haptics aren't available
  }
  // The native call is async: swallow a late rejection as well, so a missing
  // haptics engine never surfaces as an unhandled promise rejection.
  void Promise.resolve(pending).catch(() => undefined);
}

/**
 * Hook that provides haptic feedback functions
 */
export function useHaptics() {
  return {
    /** Light tap feedback - for buttons, selections */
    light: () => triggerHaptic('light'),
    /** Medium tap feedback - for toggles, drags */
    medium: () => triggerHaptic('medium'),
    /** Heavy tap feedback - for important actions */
    heavy: () => triggerHaptic('heavy'),
    /** Success feedback - for completed actions */
    success: () => triggerHaptic('success'),
    /** Warning feedback - for attention-needed actions */
    warning: () => triggerHaptic('warning'),
    /** Error feedback - for failed actions */
    error: () => triggerHaptic('error'),
    /** Selection feedback - for picker/selection changes */
    selection: () => triggerHaptic('selection'),
  };
}

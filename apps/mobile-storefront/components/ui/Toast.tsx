import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  Text,
  useColorScheme,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors, { RADIUS, SHADOWS } from '@/constants/Colors';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  message: string;
  variant?: ToastVariant;
  duration?: number;
  visible: boolean;
  onDismiss: () => void;
  position?: 'top' | 'bottom';
}

const VARIANT_ICONS: Record<ToastVariant, IoniconsIconName> = {
  success: 'checkmark-circle',
  error: 'alert-circle',
  warning: 'warning',
  info: 'information-circle',
};

function getVariantColors(
  variant: ToastVariant,
  theme: (typeof Colors)['light']
) {
  switch (variant) {
    case 'success':
      return {
        iconColor: theme.success,
        backgroundColor: theme.foreground,
        textColor: theme.background,
      };
    case 'error':
      return {
        iconColor: theme.error,
        backgroundColor: theme.foreground,
        textColor: theme.destructiveForeground,
      };
    case 'warning':
      return {
        iconColor: theme.warning,
        backgroundColor: theme.card,
        textColor: theme.foreground,
      };
    case 'info':
      return {
        iconColor: theme.tint,
        backgroundColor: theme.card,
        textColor: theme.foreground,
      };
  }
}

export function Toast({
  message,
  variant = 'success',
  duration = 3000,
  visible,
  onDismiss,
  position = 'bottom',
}: ToastProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const config = getVariantColors(variant, theme);
  const icon = VARIANT_ICONS[variant];
  // M35 fix: Store onDismiss in a ref to avoid it being a dependency in the
  // auto-dismiss useEffect. When onDismiss is an inline function, it changes
  // identity every render, causing that effect to re-fire and potentially loop.
  // The ref is synced after each commit (never written during render).
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  // Cleanup timer on unmount or when visibility changes
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Auto-dismiss logic with proper cleanup
  // M35 fix: Use onDismissRef instead of onDismiss in deps to prevent infinite re-render
  // when onDismiss is an inline function that changes identity every render.
  useEffect(() => {
    if (visible && duration > 0) {
      // Clear any existing timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        onDismissRef.current();
        timerRef.current = null;
      }, duration);

      // M35 fix: iOS requires manual announcement, Android handles live region
      if (Platform.OS === 'ios') {
        AccessibilityInfo.announceForAccessibility(message);
      }
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [visible, duration, message]);

  if (!visible) return null;

  const positionStyle =
    position === 'top'
      ? { top: insets.top + 16 }
      : { bottom: insets.bottom + 100 };

  return (
    <Animated.View
      entering={
        position === 'top' ? FadeIn.duration(200) : SlideInDown.duration(300)
      }
      exiting={
        position === 'top' ? FadeOut.duration(200) : SlideOutDown.duration(300)
      }
      style={[
        styles.container,
        positionStyle,
        { backgroundColor: config.backgroundColor },
      ]}
      accessible={true}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={message}
    >
      <Ionicons name={icon} size={20} color={config.iconColor} />
      <Text style={[styles.message, { color: config.textColor }]}>
        {message}
      </Text>
    </Animated.View>
  );
}

/**
 * useToast Hook - 2026 Best Practice
 * Provides a simple API for showing toasts with automatic cleanup
 */
export function useToast() {
  const [toastState, setToastState] = useState<{
    visible: boolean;
    message: string;
    variant: ToastVariant;
    duration: number;
  }>({
    visible: false,
    message: '',
    variant: 'success',
    duration: 3000,
  });

  const show = (
    message: string,
    options?: { variant?: ToastVariant; duration?: number }
  ) => {
    setToastState({
      visible: true,
      message,
      variant: options?.variant || 'success',
      duration: options?.duration || 3000,
    });
  };

  const hide = () => {
    setToastState((prev) => ({ ...prev, visible: false }));
  };

  const ToastComponent = () => (
    <Toast
      visible={toastState.visible}
      message={toastState.message}
      variant={toastState.variant}
      duration={toastState.duration}
      onDismiss={hide}
    />
  );

  return {
    show,
    hide,
    Toast: ToastComponent,
    // Convenience methods
    success: (message: string, duration?: number) =>
      show(message, { variant: 'success', duration }),
    error: (message: string, duration?: number) =>
      show(message, { variant: 'error', duration }),
    warning: (message: string, duration?: number) =>
      show(message, { variant: 'warning', duration }),
    info: (message: string, duration?: number) =>
      show(message, { variant: 'info', duration }),
  };
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 20,
    right: 20,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: RADIUS.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...SHADOWS.lg,
    zIndex: 9999,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
});

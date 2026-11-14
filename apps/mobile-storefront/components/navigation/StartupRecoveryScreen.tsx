import { reloadAppAsync } from 'expo';
import * as Updates from 'expo-updates';
import { useRef, useState } from 'react';
import { Pressable, Text, useColorScheme, View } from 'react-native';
import { errorBoundaryStyles as styles } from '@/components/error-boundary.styles';
import Colors from '@/constants/Colors';
import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';

interface StartupRecoveryScreenProps {
  onLayout?: () => void;
}

export function StartupRecoveryScreen({
  onLayout,
}: StartupRecoveryScreenProps) {
  const systemScheme = useColorScheme();
  const colors = Colors[systemScheme === 'dark' ? 'dark' : 'light'];
  const [failed, setFailed] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const pending = useRef(false);

  const retry = async () => {
    if (pending.current) return;
    pending.current = true;
    setRestarting(true);
    setFailed(false);
    try {
      await reloadAppAsync();
      return;
    } catch (reloadError) {
      if (Updates.isEnabled) {
        try {
          // If the native app reload bridge is unavailable, try the configured
          // Expo Updates reload path before leaving the user on this screen.
          await Updates.reloadAsync();
          return;
        } catch (updatesError) {
          recordCrashBreadcrumb('startup_recovery:reload_failed', {
            isError: true,
            errorType: errorType(reloadError),
            fallbackErrorType: errorType(updatesError),
          });
        }
      } else {
        recordCrashBreadcrumb('startup_recovery:reload_failed', {
          isError: true,
          errorType: errorType(reloadError),
          updatesEnabled: false,
        });
      }
      setFailed(true);
    } finally {
      pending.current = false;
      setRestarting(false);
    }
  };

  return (
    <View
      testID="startup-recovery-screen"
      onLayout={onLayout}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Taking longer than expected
        </Text>
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          Please try restarting the app.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          accessibilityState={{ disabled: restarting }}
          disabled={restarting}
          onPress={retry}
          style={({ pressed }) => [
            styles.retryButton,
            { backgroundColor: colors.primary },
            pressed && styles.retryButtonPressed,
          ]}
        >
          <Text
            style={[
              styles.retryButtonText,
              { color: colors.primaryForeground },
            ]}
          >
            Try again
          </Text>
        </Pressable>
        {failed && (
          <Text
            accessibilityRole="alert"
            style={[styles.message, { color: colors.destructive }]}
          >
            Could not restart automatically. Close and reopen the app, then try
            again.
          </Text>
        )}
      </View>
    </View>
  );
}

function errorType(error: unknown) {
  const name = error instanceof Error ? error.name : 'NonError';
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(name) ? name : 'Other';
}

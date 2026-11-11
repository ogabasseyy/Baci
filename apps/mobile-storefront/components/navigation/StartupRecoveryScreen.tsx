import { reloadAppAsync } from 'expo';
import { useRef, useState } from 'react';
import { Pressable, Text, useColorScheme, View } from 'react-native';
import { errorBoundaryStyles as styles } from '@/components/error-boundary.styles';
import Colors from '@/constants/Colors';

interface StartupRecoveryScreenProps {
  onLayout: () => void;
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
    } catch {
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
            Could not restart the app. Please try again.
          </Text>
        )}
      </View>
    </View>
  );
}

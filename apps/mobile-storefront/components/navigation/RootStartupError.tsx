import { useEffect } from 'react';
import { useColorScheme, View } from 'react-native';
import SplashMotion from 'react-native-splash-motion';
import { ErrorFallbackView } from '@/components/ErrorFallbackView';
import {
  classifyError,
  getErrorContent,
  logError,
} from '@/components/error-boundary-content';
import Colors from '@/constants/Colors';
import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
import { markStartupTiming } from '@/lib/startup-timing';

interface RootStartupErrorProps {
  error: Error;
  retry: () => void;
}

export function RootStartupError({ error, retry }: RootStartupErrorProps) {
  // A crash fallback should be visible immediately; a fresh intro waiter here
  // would add another timeout after the root screen has already failed.
  useEffect(() => {
    const hide = (fade: number) =>
      Promise.resolve().then(() =>
        SplashMotion.hide({ waitForLoop: false, minDuration: 0, fade })
      );

    void hide(220)
      .catch(() => {
        recordCrashBreadcrumb('root_startup_error:native_splash_hide_failed');
        markStartupTiming('splash_hide_failed');
        return hide(0);
      })
      .then(
        () => markStartupTiming('splash_hide_completed'),
        () => {
          recordCrashBreadcrumb('root_startup_error:native_splash_hide_failed');
          markStartupTiming('splash_hide_failed');
        }
      );
  }, []);
  const systemScheme = useColorScheme();
  const colors = Colors[systemScheme === 'dark' ? 'dark' : 'light'];
  useEffect(() => {
    logError(error, undefined, 'expo-router-fallback');
  }, [error]);

  return (
    <View testID="root-startup-error" style={{ flex: 1 }}>
      <ErrorFallbackView
        colors={colors}
        content={getErrorContent(classifyError(error))}
        error={error}
        onRetry={retry}
      />
    </View>
  );
}

import { useEffect } from 'react';
import { Appearance, View } from 'react-native';
import { ErrorFallbackView } from '@/components/ErrorFallbackView';
import {
  classifyError,
  getErrorContent,
  logError,
} from '@/components/error-boundary-content';
import Colors from '@/constants/Colors';
import { useNativeSplashHandoff } from '@/hooks/use-native-splash-handoff';

interface RootStartupErrorProps {
  error: Error;
  retry: () => void;
}

export function RootStartupError({ error, retry }: RootStartupErrorProps) {
  const { onFirstLayout, shouldRenderApp } = useNativeSplashHandoff({
    initialVisible: true,
    ready: true,
  });
  const colors =
    Colors[Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'];
  useEffect(() => {
    logError(error, undefined, 'expo-router-fallback');
  }, [error]);

  if (!shouldRenderApp) return <View style={{ flex: 1 }} />;

  return (
    <View
      testID="root-startup-error"
      onLayout={onFirstLayout}
      style={{ flex: 1 }}
    >
      <ErrorFallbackView
        colors={colors}
        content={getErrorContent(classifyError(error))}
        error={error}
        onRetry={retry}
      />
    </View>
  );
}

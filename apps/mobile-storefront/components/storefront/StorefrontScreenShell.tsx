import type { PropsWithChildren } from 'react';
import { type StyleProp, StyleSheet, type ViewStyle } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

interface StorefrontScreenShellProps extends PropsWithChildren {
  edges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
  testID?: string;
  themeBackground?: boolean;
}

// NativeStack already reserves the top inset. Include both horizontal edges
// unless a child owns all of its own insets and explicitly passes [].
export function StorefrontScreenShell({
  children,
  edges = ['bottom'],
  style,
  testID,
  themeBackground = false,
}: StorefrontScreenShellProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <SafeAreaView
      testID={testID}
      edges={
        edges.length === 0
          ? edges
          : [...new Set<Edge>([...edges, 'left', 'right'])]
      }
      style={[
        styles.container,
        themeBackground ? { backgroundColor: colors.background } : null,
        style,
      ]}
    >
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

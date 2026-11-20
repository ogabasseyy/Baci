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

// NativeStack already reserves the top inset. The shell keeps content
// clear of the bottom and of either side when the window has unequal insets.
export function StorefrontScreenShell({
  children,
  edges = ['bottom', 'left', 'right'],
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

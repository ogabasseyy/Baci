import type { ReactNode } from 'react';
import { type StyleProp, StyleSheet, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SPACING } from '@/constants/theme';
import { HeaderKeyboardAvoidingView } from './HeaderKeyboardAvoidingView';
import { KeyboardInsetView } from './KeyboardInsetView';

interface AppHeaderKeyboardContainerProps {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}

/**
 * Keeps a screen under a navigation header above the keyboard, moving together
 * with it on every frame. For screens with something pinned to the bottom (a
 * reply box, a floating search): the content does not scroll, and its bottom
 * spacing (the safe area) eases away as the keyboard comes up, so the pinned
 * element sits right above it.
 *
 * Uses the keyboard library, so it only belongs on screens that were moved to
 * it; the older screens keep `AppKeyboardContainer`.
 */
export function AppHeaderKeyboardContainer({
  children,
  contentContainerStyle,
  style,
}: AppHeaderKeyboardContainerProps) {
  const insets = useSafeAreaInsets();
  const contentStyle: StyleProp<ViewStyle> = [
    styles.content,
    { paddingBottom: Math.max(insets.bottom, SPACING.lg) },
    contentContainerStyle,
  ];
  const flat = StyleSheet.flatten(contentStyle);
  const resting =
    typeof flat?.paddingBottom === 'number' ? flat.paddingBottom : 0;

  return (
    <HeaderKeyboardAvoidingView style={[styles.container, style]}>
      <KeyboardInsetView
        opened={Math.min(resting, SPACING.sm)}
        resting={resting}
        style={contentStyle}
      >
        {children}
      </KeyboardInsetView>
    </HeaderKeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%' },
  content: { flexGrow: 1, justifyContent: 'flex-start' },
});

import Ionicons from '@react-native-vector-icons/ionicons';
import { usePathname } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { AppSheetModal } from '@/components/ui/AppSheetModal';
import { SPACING } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { FeedbackForm } from './FeedbackForm';

// Level with the screens' own "+" buttons (bottom-right) without covering them.
export const FEEDBACK_LAUNCHER_BOTTOM_OFFSET = 125;

/** Floating bug button that opens the "Send feedback" sheet. */
export function FeedbackLauncher() {
  const { colors, shadows } = useTheme();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  // Captured when opened so the report names the screen the merchant was on.
  const [screen, setScreen] = useState<string | null>(null);

  const open = () => {
    setScreen(pathname);
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);
  const handleSent = () => {
    setIsOpen(false);
    Alert.alert('Thanks for the feedback', 'The Baci team will look into it.');
  };

  return (
    <>
      <Pressable
        accessibilityHint="Opens a form to report a bug or share an idea"
        accessibilityLabel="Send feedback"
        accessibilityRole="button"
        hitSlop={8}
        onPress={open}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            opacity: pressed ? 0.7 : 1,
          },
          shadows.md,
        ]}
      >
        <Ionicons color={colors.text} name="bug-outline" size={22} />
      </Pressable>
      <AppSheetModal
        accessibilityLabel="Send feedback"
        onClose={close}
        visible={isOpen}
      >
        {isOpen ? (
          <FeedbackForm onCancel={close} onSent={handleSent} screen={screen} />
        ) : null}
      </AppSheetModal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    bottom: FEEDBACK_LAUNCHER_BOTTOM_OFFSET,
    height: 44,
    justifyContent: 'center',
    left: SPACING.lg,
    position: 'absolute',
    width: 44,
    zIndex: 300,
  },
});

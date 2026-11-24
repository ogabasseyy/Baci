import type { ReactNode } from 'react';
import {
  Modal,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { AppKeyboardContainer } from '@/components/ui/AppKeyboardContainer';
import { RADIUS, SPACING } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

interface AppSheetModalProps {
  accessibilityLabel: string;
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  dismissOnBackdropPress?: boolean;
  keyboardVerticalOffset?: number;
  onClose: () => void;
  presentation?: 'attached' | 'detached';
  scrollEnabled?: boolean;
  sheetStyle?: StyleProp<ViewStyle>;
  visible: boolean;
}

export function AppSheetModal({
  accessibilityLabel,
  children,
  contentContainerStyle,
  dismissOnBackdropPress = true,
  keyboardVerticalOffset = 24,
  onClose,
  presentation = 'attached',
  scrollEnabled = true,
  sheetStyle,
  visible,
}: AppSheetModalProps) {
  const { colors, shadows } = useTheme();
  const isDetached = presentation === 'detached';

  const handleBackdropPress = () => {
    if (dismissOnBackdropPress) {
      onClose();
    }
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          accessible={false}
          onPress={handleBackdropPress}
          style={[
            styles.backdrop,
            { backgroundColor: colors.backdrop ?? 'rgba(0,0,0,0.4)' },
          ]}
          testID="app-sheet-backdrop"
        />
        <AppKeyboardContainer
          // An attached sheet sits on the bottom edge: its own colour fills the
          // safe area under it. A detached one floats, so keeps the backdrop.
          bottomFillColor={isDetached ? undefined : colors.card}
          contentContainerStyle={[
            styles.keyboardContent,
            isDetached ? styles.detachedLayout : styles.attachedLayout,
            contentContainerStyle,
          ]}
          keyboardVerticalOffset={keyboardVerticalOffset}
          scrollEnabled={scrollEnabled}
        >
          <Pressable
            accessibilityElementsHidden
            accessible={false}
            onPress={handleBackdropPress}
            style={styles.dismissArea}
            testID="app-sheet-dismiss-area"
          />
          <View
            accessibilityLabel={accessibilityLabel}
            accessibilityViewIsModal={true}
            style={[
              styles.sheet,
              isDetached ? styles.detachedSheet : styles.attachedSheet,
              isDetached
                ? [
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    },
                    shadows.lg,
                  ]
                : { backgroundColor: colors.card },
              sheetStyle,
            ]}
          >
            {children}
          </View>
        </AppKeyboardContainer>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  keyboardContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
    width: '100%',
  },
  attachedLayout: {
    width: '100%',
  },
  detachedLayout: {
    paddingHorizontal: SPACING.lg,
  },
  sheet: {
    overflow: 'hidden',
    width: '100%',
  },
  attachedSheet: {
    borderTopLeftRadius: RADIUS['2xl'],
    borderTopRightRadius: RADIUS['2xl'],
    padding: SPACING.xl,
  },
  detachedSheet: {
    alignSelf: 'center',
    borderRadius: RADIUS['2xl'],
    borderWidth: 1,
    maxWidth: 480,
    padding: SPACING.lg,
  },
});

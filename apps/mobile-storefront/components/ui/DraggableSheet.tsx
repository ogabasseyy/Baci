import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import Feather from '@react-native-vector-icons/feather';
import { type ReactNode, useCallback } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';

interface DraggableSheetProps {
  visible: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}

// Hoisted so the sheet config keeps a stable identity while mounted;
// recreating snap points per render can desync bottom-sheet gestures.
const SHEET_SNAP_POINTS = ['45%', '80%'];

export function DraggableSheet({
  visible,
  title,
  closeLabel,
  onClose,
  children,
}: DraggableSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // No onPress here: pressBehavior="close" already closes the sheet, which
  // fires BottomSheet's onClose — an explicit onPress would invoke it twice.
  const backdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    []
  );
  return (
    <Modal
      testID="draggable-sheet-modal"
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.modal}>
        {visible && (
          <BottomSheet
            index={0}
            snapPoints={SHEET_SNAP_POINTS}
            enableDynamicSizing={false}
            enablePanDownToClose
            onClose={onClose}
            backdropComponent={backdrop}
            backgroundStyle={{ backgroundColor: colors.card }}
            handleIndicatorStyle={{ backgroundColor: colors.textSecondary }}
            topInset={insets.top}
            keyboardBehavior="interactive"
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
          >
            <BottomSheetScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[
                styles.content,
                { paddingBottom: insets.bottom + 24 },
              ]}
            >
              <View accessibilityViewIsModal>
                <View style={styles.header}>
                  <Text
                    accessibilityRole="header"
                    style={[styles.title, { color: colors.text }]}
                  >
                    {title}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={closeLabel}
                    onPress={onClose}
                    style={styles.close}
                  >
                    <Feather name="x" size={24} color={colors.text} />
                  </Pressable>
                </View>
                {children}
              </View>
            </BottomSheetScrollView>
          </BottomSheet>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1 },
  content: { padding: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  title: { fontSize: 24, fontWeight: '700' },
  close: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

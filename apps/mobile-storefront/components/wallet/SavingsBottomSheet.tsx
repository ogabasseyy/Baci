import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { type ReactNode, useRef } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type Colors from '@/constants/Colors';
import { SavingsSheetContext } from './SavingsSheetContext';
import { SavingsSheetPinCancelContext } from './SavingsSheetPinCancelContext';

const DEFAULT_SNAP_POINTS = ['72%', '92%'];

/** Let Gorhom own backdrop dismissal so closing retains its exit animation. */
function SavingsBackdrop(props: BottomSheetBackdropProps) {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      pressBehavior="close"
      opacity={0.5}
    />
  );
}

/** Own sheet gestures and defer parent dismissal until the exit animation completes. */
export function SavingsBottomSheet({
  children,
  colors,
  onClose,
  overlay,
  snapPoints = DEFAULT_SNAP_POINTS,
  visible,
}: {
  children: ReactNode | ((dismiss: () => void) => ReactNode);
  colors: (typeof Colors)['light'];
  onClose: () => void;
  /**
   * A modal that must appear above this sheet (the wallet PIN prompt). iOS
   * presents a second sibling modal only from the topmost one, so it is
   * rendered inside this sheet's modal instead of beside it.
   */
  overlay?: ReactNode;
  /** Opening height first, then the expanded height. */
  snapPoints?: string[];
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const sheet = useRef<BottomSheet>(null);
  // The embedded PIN step's cancel, if one is showing: closing this sheet
  // cancels it first so the PIN request never outlives the sheet.
  const pinCancel = useRef<(() => void) | null>(null);
  const registerPinCancel = (cancel: (() => void) | null) => {
    pinCancel.current = cancel;
  };
  const dismiss = () => sheet.current?.close();
  const close = () => {
    const cancel = pinCancel.current;
    pinCancel.current = null;
    cancel?.();
    onClose();
  };
  if (!visible) return null;
  return (
    <Modal
      transparent
      visible
      animationType="none"
      presentationStyle="overFullScreen"
      onRequestClose={dismiss}
    >
      <GestureHandlerRootView style={styles.root}>
        <SavingsSheetContext.Provider value={true}>
          <SavingsSheetPinCancelContext.Provider value={registerPinCancel}>
            <BottomSheet
              ref={sheet}
              index={0}
              snapPoints={snapPoints}
              enableDynamicSizing={false}
              enablePanDownToClose
              enableBlurKeyboardOnGesture
              keyboardBehavior="interactive"
              keyboardBlurBehavior="restore"
              android_keyboardInputMode="adjustResize"
              topInset={insets.top}
              backdropComponent={SavingsBackdrop}
              onClose={close}
              backgroundStyle={[
                styles.background,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.primary,
                },
              ]}
              handleIndicatorStyle={{
                backgroundColor: colors.primary,
                width: 40,
              }}
            >
              <View
                accessibilityViewIsModal
                style={[
                  styles.content,
                  { paddingBottom: Math.max(insets.bottom, 16) },
                ]}
              >
                {typeof children === 'function' ? children(dismiss) : children}
                {/* The PIN step takes over this same sheet rather than opening
                  a second one on top. */}
                {overlay}
              </View>
            </BottomSheet>
          </SavingsSheetPinCancelContext.Provider>
        </SavingsSheetContext.Provider>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  background: {
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
});

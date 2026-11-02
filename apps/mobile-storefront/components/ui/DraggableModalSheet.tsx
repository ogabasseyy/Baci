import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import BottomSheet, { BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import type { ReactNode } from 'react';
import { Modal, StyleSheet, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND, RADIUS } from '@/constants/Colors';

type Props = {
  embedded?: boolean;
  fitContent?: boolean;
  backgroundColor: string;
  borderColor?: string;
  children: ReactNode;
  handleColor?: string;
  onClose: () => void;
  visible: boolean;
};

const SNAP_POINTS = ['75%', '92%'];

function SheetBackdrop(props: BottomSheetBackdropProps) {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      pressBehavior="close"
      opacity={0.55}
    />
  );
}

export function DraggableModalSheet({
  backgroundColor,
  borderColor = BRAND.primary,
  children,
  handleColor = BRAND.primary,
  onClose,
  visible,
  embedded = false,
  fitContent = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  if (!visible) return null;
  if (embedded) return <>{children}</>;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      accessibilityViewIsModal
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.root}>
        <BottomSheet
          key={fitContent ? 'content-sized' : 'snap-sized'}
          accessible={false}
          index={0}
          snapPoints={fitContent ? undefined : SNAP_POINTS}
          enableDynamicSizing={fitContent}
          detached={false}
          bottomInset={0}
          maxDynamicContentSize={Math.max(1, height - insets.top) * 0.92}
          enablePanDownToClose
          enableBlurKeyboardOnGesture
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          android_keyboardInputMode="adjustResize"
          topInset={insets.top}
          backdropComponent={SheetBackdrop}
          backgroundStyle={{
            backgroundColor,
            borderColor,
            borderWidth: borderColor ? 1.5 : 0,
            borderTopLeftRadius: RADIUS['2xl'],
            borderTopRightRadius: RADIUS['2xl'],
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
          }}
          handleIndicatorStyle={{ backgroundColor: handleColor, width: 40 }}
          onChange={(index) => {
            if (index === -1) onClose();
          }}
        >
          {children}
        </BottomSheet>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { BackHandler, Modal, Platform, StyleSheet, View } from 'react-native';

export function CheckoutSheetPresentation({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const inline = Platform.OS === 'android';

  useEffect(() => {
    if (!inline) return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onClose();
        return true;
      }
    );
    return () => subscription.remove();
  }, [inline, onClose]);

  if (inline) {
    return <View style={styles.overlay}>{children}</View>;
  }

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      {children}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
});

import { type ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GlobalErrorBoundary } from '@/components/ErrorBoundary';
import { CheckoutIdentityModal } from './CheckoutIdentityModal';
import { CheckoutIdentityOverlayContext } from './CheckoutIdentityOverlayContext';

/** Host the Android inline checkout sheet above navigation and app chrome. */
export function CheckoutIdentityOverlayProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [onVerified, setOnVerified] = useState<(() => void) | undefined>();
  const [onGuestCheckout, setOnGuestCheckout] = useState<
    (() => void) | undefined
  >();

  const open = (onVerified?: () => void, onGuestCheckout?: () => void) => {
    setOnVerified(() => onVerified);
    setOnGuestCheckout(() => onGuestCheckout);
    setIsOpen(true);
  };
  const close = () => {
    setOnVerified(undefined);
    setOnGuestCheckout(undefined);
    setIsOpen(false);
  };

  return (
    <CheckoutIdentityOverlayContext.Provider value={{ isOpen, open, close }}>
      {/* This is a root-level modal; fence app chrome as well as Cart content. */}
      <View style={styles.root}>
        <View
          style={[styles.content, { pointerEvents: isOpen ? 'none' : 'auto' }]}
          importantForAccessibility={isOpen ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={isOpen}
        >
          {children}
        </View>
        <GlobalErrorBoundary context="CheckoutIdentityOverlay">
          <CheckoutIdentityModal
            isOpen={isOpen}
            onClose={close}
            onVerified={onVerified}
            onGuestCheckout={onGuestCheckout}
          />
        </GlobalErrorBoundary>
      </View>
    </CheckoutIdentityOverlayContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
});

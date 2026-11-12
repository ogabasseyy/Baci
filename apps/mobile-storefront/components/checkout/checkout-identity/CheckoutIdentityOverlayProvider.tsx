import {
  createContext,
  type ReactNode,
  useContext,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { CheckoutIdentityModal } from './CheckoutIdentityModal';

interface CheckoutIdentityOverlayContextValue {
  isOpen: boolean;
  open: (onVerified?: () => void) => void;
  close: () => void;
}

const CheckoutIdentityOverlayContext =
  createContext<CheckoutIdentityOverlayContextValue | null>(null);

export function useCheckoutIdentityOverlay() {
  const context = useContext(CheckoutIdentityOverlayContext);
  if (!context) {
    throw new Error(
      'useCheckoutIdentityOverlay must be used inside CheckoutIdentityOverlayProvider.'
    );
  }
  return context;
}

/** Host the Android inline checkout sheet above navigation and app chrome. */
export function CheckoutIdentityOverlayProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const onVerifiedRef = useRef<(() => void) | undefined>(undefined);

  const open = (onVerified?: () => void) => {
    onVerifiedRef.current = onVerified;
    setIsOpen(true);
  };
  const close = () => {
    onVerifiedRef.current = undefined;
    setIsOpen(false);
  };

  return (
    <CheckoutIdentityOverlayContext.Provider value={{ isOpen, open, close }}>
      <View style={styles.root}>
        <View
          style={[styles.content, { pointerEvents: isOpen ? 'none' : 'auto' }]}
          importantForAccessibility={isOpen ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={isOpen}
        >
          {children}
        </View>
        <CheckoutIdentityModal
          isOpen={isOpen}
          onClose={close}
          onVerified={onVerifiedRef.current}
        />
      </View>
    </CheckoutIdentityOverlayContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
});

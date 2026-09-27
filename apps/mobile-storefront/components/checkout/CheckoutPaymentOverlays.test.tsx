import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { CheckoutPaymentOverlays } from './CheckoutPaymentOverlays';

const mockSelection = jest.fn(({ onClose }: { onClose: () => void }) => {
  const { Pressable, Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return (
    <Pressable accessibilityRole="button" onPress={onClose}>
      <Text>Close crypto selection</Text>
    </Pressable>
  );
});
const mockPayment = jest.fn(
  ({
    onChangeSelection,
    onClosePayment,
  }: {
    onChangeSelection: () => void;
    onClosePayment: () => void;
  }) => {
    const { Pressable, Text } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return (
      <>
        <Pressable accessibilityRole="button" onPress={onChangeSelection}>
          <Text>Change crypto selection</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onClosePayment}>
          <Text>Close crypto payment</Text>
        </Pressable>
      </>
    );
  }
);
jest.mock('./CryptoSelectionModal', () => ({
  CryptoSelectionModal: (props: Parameters<typeof mockSelection>[0]) =>
    mockSelection(props),
}));
jest.mock('./CheckoutCryptoPaymentModal', () => ({
  CheckoutCryptoPaymentModal: (props: Parameters<typeof mockPayment>[0]) =>
    mockPayment(props),
}));

it('preserves ordinary crypto selection and empty payment overlays', () => {
  const crypto = {
    cryptoPayment: null,
    showCryptoSelection: false,
    setCryptoPayment: jest.fn(),
    setShowCryptoSelection: jest.fn(),
    setPendingOrder: jest.fn(),
    handleCryptoConfirm: jest.fn(),
  };
  render(
    <CheckoutPaymentOverlays
      crypto={crypto}
      clearCart={jest.fn()}
      colors={Colors.light}
      isProcessing={false}
    />
  );
  expect(mockSelection).toHaveBeenCalledWith(
    expect.objectContaining({
      visible: false,
      onConfirm: crypto.handleCryptoConfirm,
    })
  );
  expect(mockPayment).toHaveBeenCalledWith(
    expect.objectContaining({ cryptoPayment: null })
  );
});

it('forwards overlay close and change callbacks to crypto state', () => {
  const crypto = {
    cryptoPayment: null,
    showCryptoSelection: true,
    setCryptoPayment: jest.fn(),
    setShowCryptoSelection: jest.fn(),
    setPendingOrder: jest.fn(),
    handleCryptoConfirm: jest.fn(),
  };
  render(
    <CheckoutPaymentOverlays
      crypto={crypto}
      clearCart={jest.fn()}
      colors={Colors.light}
      isProcessing={false}
    />
  );

  fireEvent.press(
    screen.getByRole('button', { name: 'Close crypto selection' })
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Change crypto selection' })
  );
  fireEvent.press(screen.getByRole('button', { name: 'Close crypto payment' }));

  expect(crypto.setShowCryptoSelection).toHaveBeenNthCalledWith(1, false);
  expect(crypto.setCryptoPayment).toHaveBeenNthCalledWith(1, null);
  expect(crypto.setShowCryptoSelection).toHaveBeenNthCalledWith(2, true);
  expect(crypto.setCryptoPayment).toHaveBeenNthCalledWith(2, null);
});

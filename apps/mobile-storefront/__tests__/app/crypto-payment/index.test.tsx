import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';
import CryptoPaymentScreen from '@/app/crypto-payment';

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockClearCart = jest.fn();
let mockSearchParams: Record<string, string> = {
  address: 'TWalletAddress123',
  amount: '100000',
  chain: 'TRX',
  cryptoAmount: '60.5',
  currency: 'USDT',
  orderId: 'order-123',
  orderNumber: 'ORD-123',
  reference: 'crypto-ref-123',
};

jest.mock('expo-router', () => ({
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  Stack: {
    Screen: ({ options }: { options?: { headerLeft?: () => ReactNode } }) =>
      options?.headerLeft?.() ?? null,
  },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => {
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return <View>{children}</View>;
  },
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/lib/clipboard', () => ({
  setClipboardString: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: (selector: (state: { clearCart: () => void }) => unknown) =>
    selector({ clearCart: mockClearCart }),
}));

describe('CryptoPaymentScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = {
      address: 'TWalletAddress123',
      amount: '100000',
      chain: 'TRX',
      cryptoAmount: '60.5',
      currency: 'USDT',
      orderId: 'order-123',
      orderNumber: 'ORD-123',
      reference: 'crypto-ref-123',
    };
  });

  it('clears the cart and routes completed payment to order success', async () => {
    render(<CryptoPaymentScreen />);

    fireEvent.press(
      screen.getByRole('button', { name: "I've Sent the Payment" })
    );

    await waitFor(() => {
      expect(mockClearCart).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/order-success',
        params: {
          orderId: 'order-123',
          orderNumber: 'ORD-123',
          paymentMethod: 'juicyway',
        },
      });
    });
  });

  it('shows the validation error when required payment params are missing', () => {
    mockSearchParams = { orderId: 'order-123' };

    render(<CryptoPaymentScreen />);

    expect(screen.getByText('Invalid Payment')).toBeTruthy();
    expect(
      screen.getByText(
        /^(Invalid input: expected string, received undefined|Required)$/
      )
    ).toBeTruthy();
  });

  it('confirms leaving payment and navigates back without completing it', () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    render(<CryptoPaymentScreen />);

    fireEvent.press(
      screen.getByRole('button', { name: 'Close crypto payment' })
    );

    expect(alert).toHaveBeenCalledWith(
      'Leave Payment?',
      'Your order has been created. You can complete the crypto payment using the wallet address shown. Make sure to copy it before leaving.',
      expect.any(Array)
    );

    const buttons = alert.mock.calls[0]?.[2];
    buttons?.[1]?.onPress?.();

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockClearCart).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

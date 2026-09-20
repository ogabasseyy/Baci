import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { router } from 'expo-router';
import type React from 'react';
import { Alert } from 'react-native';
import BankTransferScreen from '@/app/bank-transfer';

const mockClearCart = jest.fn();
const mockPersistStorageSetItem = jest.fn<
  (key: string, value: unknown) => Promise<void>
>(() => Promise.resolve());
const mockGetOrderWalletFundingIntent =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCartState = {
  clearCart: mockClearCart,
  items: [],
  lineSequence: 0,
};
let mockSearchParams: Record<string, string> = {
  accountName: 'Baci Store',
  accountNumber: '1234567890',
  amount: '250000',
  bankName: 'Test Bank',
  orderId: 'order-123',
  orderNumber: 'ORD-123',
  reference: 'dva-ref-123',
  trackingToken: 'track-token-123',
};

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  router: {
    back: jest.fn(),
    replace: jest.fn(),
  },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: React.ReactNode }) => {
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

jest.mock('@/lib/order-wallet-funding-intent', () => ({
  getOrderWalletFundingIntent: (...args: unknown[]) =>
    mockGetOrderWalletFundingIntent(...args),
}));

jest.mock('@/stores/cart-store', () => ({
  formatPrice: (amount: number) => `₦${amount.toLocaleString('en-NG')}`,
  useCartStore: Object.assign(
    (selector: (state: typeof mockCartState) => unknown) =>
      selector(mockCartState),
    {
      getState: jest.fn(() => mockCartState),
      persist: {
        getOptions: jest.fn(() => ({
          name: 'cart-storage',
          partialize: (state: typeof mockCartState) => ({
            items: state.items,
            lineSequence: state.lineSequence,
          }),
          storage: {
            setItem: (key: string, value: unknown) =>
              mockPersistStorageSetItem(key, value),
          },
          version: 0,
        })),
      },
    }
  ),
}));

describe('BankTransferScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPersistStorageSetItem.mockResolvedValue(undefined);
    mockGetOrderWalletFundingIntent.mockResolvedValue({
      intent: {
        currency: 'NGN',
        debitedAmount: 250000,
        excessAmount: 0,
        expectedAmount: 250000,
        expiresAt: '2026-05-27T12:00:00.000Z',
        fundedAmount: 250000,
        id: 'intent-123',
        orderId: 'order-123',
        status: 'completed',
        targetOrderAmount: 250000,
      },
    });
    mockSearchParams = {
      accountName: 'Baci Store',
      accountNumber: '1234567890',
      amount: '250000',
      bankName: 'Test Bank',
      orderId: 'order-123',
      orderNumber: 'ORD-123',
      reference: 'dva-ref-123',
      trackingToken: 'track-token-123',
    };
  });

  it('preserves tracking token when routing to order success', async () => {
    render(<BankTransferScreen />);

    fireEvent.press(
      screen.getByRole('button', { name: "Confirm I've sent the money" })
    );

    expect(mockClearCart).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(mockPersistStorageSetItem).toHaveBeenCalledWith('cart-storage', {
        state: { items: [], lineSequence: 0 },
        version: 0,
      });
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/order-success',
        params: {
          orderId: 'order-123',
          orderNumber: 'ORD-123',
          paymentMethod: 'bank_transfer',
          reference: 'dva-ref-123',
          trackingToken: 'track-token-123',
        },
      });
    });
  });

  it('omits tracking token when routing order success without a token', async () => {
    mockSearchParams = {
      accountName: 'Baci Store',
      accountNumber: '1234567890',
      amount: '250000',
      bankName: 'Test Bank',
      orderId: 'order-123',
      orderNumber: 'ORD-123',
      reference: 'dva-ref-123',
    };

    render(<BankTransferScreen />);

    fireEvent.press(
      screen.getByRole('button', { name: "Confirm I've sent the money" })
    );

    expect(mockClearCart).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/order-success',
        params: {
          orderId: 'order-123',
          orderNumber: 'ORD-123',
          paymentMethod: 'bank_transfer',
          reference: 'dva-ref-123',
        },
      });
    });
  });

  it('routes to order success even when cleared cart persistence fails', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const persistError = new Error('storage failed');
    mockPersistStorageSetItem.mockRejectedValueOnce(persistError);

    render(<BankTransferScreen />);

    fireEvent.press(
      screen.getByRole('button', { name: "Confirm I've sent the money" })
    );

    expect(mockClearCart).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/order-success',
        params: {
          orderId: 'order-123',
          orderNumber: 'ORD-123',
          paymentMethod: 'bank_transfer',
          reference: 'dva-ref-123',
          trackingToken: 'track-token-123',
        },
      });
    });
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        '[BankTransfer] Failed to persist cleared cart before success redirect',
        persistError
      );
    });
    warnSpy.mockRestore();
  });

  it('treats an explicit walletFunded=false flag as legacy even when intentId is present', () => {
    mockSearchParams = {
      accountName: 'Baci Store',
      accountNumber: '1234567890',
      amount: '250000',
      bankName: 'Test Bank',
      intentId: 'intent-123',
      orderId: 'order-123',
      orderNumber: 'ORD-123',
      reference: 'dva-ref-123',
      walletFunded: 'false',
    };

    render(<BankTransferScreen />);

    expect(mockGetOrderWalletFundingIntent).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: "Confirm I've sent the money" })
    ).toBeTruthy();
  });

  it('clears cart and routes to success only after wallet-funded intent completes', async () => {
    mockSearchParams = {
      accountName: 'Ogabassey Jane',
      accountNumber: '9971002551',
      amount: '250000',
      bankName: 'Paystack-Titan',
      intentId: 'intent-123',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
      orderNumber: 'ORD-123',
      trackingToken: 'track-token-123',
      walletFunded: 'true',
    };

    render(<BankTransferScreen />);

    expect(mockClearCart).not.toHaveBeenCalled();

    await screen.findByText(
      'We will fund your wallet and pay this order automatically.'
    );

    await waitFor(() => {
      expect(mockGetOrderWalletFundingIntent).toHaveBeenCalledWith({
        intentId: 'intent-123',
        merchantId: undefined,
        merchantSlug: 'ogabassey',
      });
      expect(mockClearCart).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/order-success',
        params: {
          orderId: 'order-123',
          orderNumber: 'ORD-123',
          paymentMethod: 'bank_transfer',
          reference: 'intent-123',
          trackingToken: 'track-token-123',
        },
      });
    });
  });

  it('keeps wallet-funded transfers on screen when status polling fails', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mockGetOrderWalletFundingIntent.mockRejectedValueOnce(new Error('fail'));
    mockSearchParams = {
      accountName: 'Ogabassey Jane',
      accountNumber: '9971002551',
      amount: '250000',
      bankName: 'Paystack-Titan',
      intentId: 'intent-123',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
      orderNumber: 'ORD-123',
      walletFunded: 'true',
    };

    render(<BankTransferScreen />);

    expect(
      await screen.findByText(
        'We will fund your wallet and pay this order automatically.'
      )
    ).toBeTruthy();
    await waitFor(() => {
      expect(mockGetOrderWalletFundingIntent).toHaveBeenCalled();
      expect(screen.getByText('Auto-check stopped')).toBeTruthy();
    });
    expect(mockClearCart).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('shows immediate feedback when manual wallet-funded status check fails', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockGetOrderWalletFundingIntent.mockRejectedValue(new Error('fail'));
    mockSearchParams = {
      accountName: 'Ogabassey Jane',
      accountNumber: '9971002551',
      amount: '250000',
      bankName: 'Paystack-Titan',
      intentId: 'intent-123',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
      orderNumber: 'ORD-123',
      walletFunded: 'true',
    };

    render(<BankTransferScreen />);

    await screen.findByText('Auto-check stopped');
    fireEvent.press(
      screen.getByRole('button', { name: 'Check payment status' })
    );

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Unable to check payment status',
        'Please try again in a moment.'
      );
    });
    expect(router.replace).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('keeps wallet-funded underfunded transfers on the transfer screen', async () => {
    mockGetOrderWalletFundingIntent.mockResolvedValueOnce({
      intent: {
        currency: 'NGN',
        debitedAmount: 0,
        excessAmount: 0,
        expectedAmount: 250000,
        expiresAt: '2026-05-27T12:00:00.000Z',
        fundedAmount: 200000,
        id: 'intent-123',
        orderId: 'order-123',
        status: 'underfunded',
        targetOrderAmount: 250000,
      },
    });
    mockSearchParams = {
      accountName: 'Ogabassey Jane',
      accountNumber: '9971002551',
      amount: '250000',
      bankName: 'Paystack-Titan',
      intentId: 'intent-123',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
      orderNumber: 'ORD-123',
      walletFunded: 'true',
    };

    render(<BankTransferScreen />);

    expect(await screen.findByText('Transfer remaining amount')).toBeTruthy();
    expect(screen.getByText('₦50,000 still needed')).toBeTruthy();
    expect(mockClearCart).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import { render, waitFor } from '@testing-library/react-native';
import { act } from 'react';

const mockRouterReplace = jest.fn();
let mockRouteParams: Record<string, string> = {};
let pollingOptions:
  | { onCompleted?: (intent: { id: string }) => void }
  | undefined;
const mockTrackCompletedOnce =
  jest.fn<(input: Record<string, unknown>) => Promise<boolean>>();
const mockClearCart = jest.fn();
const mockCartItems = [
  {
    id: 'item-1',
    name: 'Test Product',
    price: 450000,
    quantity: 1,
  },
];

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: jest.fn(), replace: mockRouterReplace },
  useLocalSearchParams: () => mockRouteParams,
}));

jest.mock('@react-native-vector-icons/ionicons', () => () => null);

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

let bankTransferViewProps: { onConfirmTransfer?: () => void } | undefined;
jest.mock('@/components/bank-transfer/BankTransferView', () => ({
  BankTransferView: (props: { onConfirmTransfer?: () => void }) => {
    bankTransferViewProps = props;
    return null;
  },
}));

jest.mock('@/hooks/use-wallet-funding-polling', () => ({
  useWalletFundingPolling: (options: {
    onCompleted?: (intent: { id: string }) => void;
  }) => {
    pollingOptions = options;
    return { isPolling: false, checkNow: jest.fn() };
  },
}));

jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentCompletedOnce: (input: Record<string, unknown>) =>
    mockTrackCompletedOnce(input),
}));

jest.mock('@/lib/clipboard', () => ({
  setClipboardString: jest.fn(async () => true),
}));

const mockUseCartStore = Object.assign(
  (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ clearCart: mockClearCart, items: mockCartItems }),
  {
    getState: () => ({ clearCart: mockClearCart, items: mockCartItems }),
    persist: { getOptions: () => ({}) },
  }
);
jest.mock('@/stores/cart-store', () => ({
  useCartStore: mockUseCartStore,
}));

let BankTransferScreen: typeof import('@/app/bank-transfer')['default'];

describe('BankTransferScreen wallet-funded completion', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    pollingOptions = undefined;
    mockRouteParams = {
      accountName: 'Ada Lovelace',
      accountNumber: '1234567890',
      amount: '20000',
      bankName: 'Paystack Bank',
      customerEmail: 'guest@example.com',
      customerPhone: '+2348123456789',
      intentId: 'intent-1',
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      orderTotal: '470000',
      shipping: '15000',
      subtotal: '450000',
      tax: '5000',
      trackingToken: 'tracking-token',
      walletFunded: 'true',
    };
    ({ default: BankTransferScreen } = await import('@/app/bank-transfer'));
  });

  it('claims completion with the routed guest attribution and breakdown', async () => {
    mockTrackCompletedOnce.mockResolvedValue(true);
    render(<BankTransferScreen />);
    expect(pollingOptions?.onCompleted).toBeDefined();

    await act(async () => {
      pollingOptions?.onCompleted?.({ id: 'intent-1' });
    });

    // The durable claim must keep the guest identity, cart lines, and the
    // known subtotal/shipping/tax: the success screen cannot enrich the
    // claim afterwards.
    await waitFor(() => {
      expect(mockTrackCompletedOnce).toHaveBeenCalledWith({
        customerEmail: 'guest@example.com',
        customerPhone: '+2348123456789',
        items: mockCartItems,
        orderId: 'order-1',
        orderNumber: 'BAC-001',
        paymentMethod: 'bank_transfer',
        reference: 'intent-1',
        shipping: 15000,
        subtotal: 450000,
        tax: 5000,
        value: 470000,
      });
    });
    expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: expect.objectContaining({ orderId: 'order-1' }),
    });
  });
});

describe('BankTransferScreen legacy confirm', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    bankTransferViewProps = undefined;
    mockRouteParams = {
      accountName: 'Ada Lovelace',
      accountNumber: '1234567890',
      amount: '470000',
      bankName: 'Paystack Bank',
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      reference: 'DVA-ref-9',
      trackingToken: 'tracking-token',
    };
    ({ default: BankTransferScreen } = await import('@/app/bank-transfer'));
  });

  it('forwards the DVA reference to order success on confirm', async () => {
    render(<BankTransferScreen />);
    expect(bankTransferViewProps?.onConfirmTransfer).toBeDefined();

    await act(async () => {
      bankTransferViewProps?.onConfirmTransfer?.();
    });

    // The deferred settlement capture reconciles through the provider
    // reference; dropping it strands the conversion like the old empty
    // handoff did.
    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith({
        pathname: '/order-success',
        params: expect.objectContaining({
          orderId: 'order-1',
          paymentMethod: 'bank_transfer',
          reference: 'DVA-ref-9',
          trackingToken: 'tracking-token',
        }),
      });
    });
  });
});

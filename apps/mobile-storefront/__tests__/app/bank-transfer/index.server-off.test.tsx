import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';

let mockRouteParams: Record<string, string> = {};
let mockViewProps: { walletTransferFallback?: boolean } | undefined;

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockRouteParams,
}));
jest.mock('@react-native-vector-icons/ionicons', () => () => null);
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/components/bank-transfer/BankTransferView', () => ({
  BankTransferView: (props: { walletTransferFallback?: boolean }) => {
    mockViewProps = props;
    return null;
  },
}));
jest.mock('@/hooks/use-wallet-funding-polling', () => ({
  useWalletFundingPolling: () => ({ isPolling: false, checkNow: jest.fn() }),
}));
jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentCompletedOnce: jest.fn(),
}));
jest.mock('@/lib/clipboard', () => ({
  setClipboardString: jest.fn(async () => true),
}));
const mockUseCartStore = Object.assign(
  (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ clearCart: jest.fn(), items: [] }),
  {
    getState: () => ({ clearCart: jest.fn(), items: [] }),
    persist: { getOptions: () => ({}) },
  }
);
jest.mock('@/stores/cart-store', () => ({ useCartStore: mockUseCartStore }));

const legacyParams = {
  accountName: 'Ada Buyer',
  accountNumber: '0123456789',
  amount: '5750',
  bankName: 'Test Bank',
  orderId: 'order-1',
  orderNumber: 'ORD-1',
  reference: 'ref-dva-1',
};

let BankTransferScreen: typeof import('@/app/bank-transfer')['default'];

beforeEach(async () => {
  mockViewProps = undefined;
  ({ default: BankTransferScreen } = await import('@/app/bank-transfer'));
});

describe('bugfix: wallet transfer switched at Place Order without a notice', () => {
  it('shows the notice when checkout routed with the fallback flag', () => {
    mockRouteParams = { ...legacyParams, walletTransferFallback: '1' };

    render(<BankTransferScreen />);

    expect(mockViewProps?.walletTransferFallback).toBe(true);
  });
});

describe('server keeps PiggyVest off', () => {
  it('shows no notice on an ordinary bank transfer', () => {
    mockRouteParams = legacyParams;

    render(<BankTransferScreen />);

    expect(mockViewProps?.walletTransferFallback).toBe(false);
  });
});

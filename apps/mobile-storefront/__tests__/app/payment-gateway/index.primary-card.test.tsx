import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import PaymentGatewayScreen from '@/app/payment-gateway';
import { createPrimaryWalletCardFundingClient } from '@/lib/primary-wallet-card';

let mockUserId = '11111111-1111-4111-8111-111111111111';
const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const operationId = '22222222-2222-4222-8222-222222222222';
const mockStorage = new Map<string, string>();
const mockFetchJson = jest.fn<Promise<unknown>, [unknown]>();
const mockInvalidate = jest.fn(() => Promise.resolve());
const mockClearCart = jest.fn();
const mockReturnTo =
  '/wallet?action=savings&savingsGoalId=owned-goal&savingsAmount=1000';
const response = {
  operationId,
  amountKobo: 100000,
  currency: 'NGN',
  reference: `pvb-first-primary-${operationId}`,
  status: 'ready',
  authorizationUrl: 'https://checkout.paystack.com/Synthetic123',
};
jest.mock('expo-crypto', () => ({
  randomUUID: () => '33333333-3333-4333-8333-333333333333',
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => mockStorage.set(key, value),
    removeItem: async (key: string) => mockStorage.delete(key),
  },
}));
jest.mock('@/lib/storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: async () => ({
        data: { user: { id: mockUserId } },
        error: null,
      }),
    },
  },
}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({
    paymentKind: 'primary_wallet_card',
    gateway: 'paystack',
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    reference: 'pvb-first-primary-22222222-2222-4222-8222-222222222222',
    authorizationUrl: 'https://checkout.paystack.com/Synthetic123',
    amount: '1000',
    returnTo: mockReturnTo,
  }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (select: (state: unknown) => unknown) =>
      select({ user: { id: mockUserId }, customer: null }),
    { getState: () => ({ user: { id: mockUserId } }) }
  ),
}));
jest.mock('@/stores/cart-store', () => ({
  useCartStore: (select: (state: unknown) => unknown) =>
    select({ clearCart: mockClearCart }),
}));
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ error: jest.fn(), success: jest.fn(), Toast: () => null }),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: require('react-native').View,
}));
jest.mock('@/components/payment-gateway/PaymentGatewayCheckoutView', () => ({
  PaymentGatewayCheckoutView: ({
    onMessage,
  }: {
    onMessage: (event: unknown) => void;
  }) => {
    const React = require('react') as typeof import('react');
    const { Pressable, Text } =
      require('react-native') as typeof import('react-native');
    return React.createElement(
      Pressable,
      {
        accessibilityRole: 'button',
        onPress: () =>
          onMessage({
            nativeEvent: { data: JSON.stringify({ type: 'payment_success' }) },
          }),
      },
      React.createElement(Text, null, 'Synthetic checkout callback')
    );
  },
}));

beforeEach(async () => {
  jest.clearAllMocks();
  mockUserId = '11111111-1111-4111-8111-111111111111';
  mockStorage.clear();
  mockFetchJson.mockResolvedValue(response);
  await createPrimaryWalletCardFundingClient().start({
    merchantId,
    userId: mockUserId,
    amountKobo: 100000,
    consent: {
      version: 'primary-wallet-card-v1',
      oneTimeCharge: true,
      saveCard: false,
    },
    returnTo: mockReturnTo,
  });
  mockFetchJson.mockClear();
});

it('blocks another account through the actual controller and lets the original owner recover after signing back in', async () => {
  mockUserId = '44444444-4444-4444-8444-444444444444';
  render(<PaymentGatewayScreen />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Synthetic checkout callback' })
  );
  await waitFor(() =>
    expect(screen.getByText('Could not check funding status')).toBeOnTheScreen()
  );
  expect(mockFetchJson).not.toHaveBeenCalled();
  expect(mockStorage.size).toBe(1);
  mockUserId = '11111111-1111-4111-8111-111111111111';
  mockFetchJson.mockResolvedValue({ ...response, status: 'custody_pending' });
  fireEvent.press(screen.getByRole('button', { name: 'Check funding status' }));
  await waitFor(() =>
    expect(screen.getByText('Wallet funding pending')).toBeOnTheScreen()
  );
  expect(mockFetchJson).toHaveBeenCalledTimes(1);
  expect(mockInvalidate).not.toHaveBeenCalled();
  expect(mockStorage.size).toBe(1);
});

it('checks the same durable operation through the actual callback, pending button and controller after restart', async () => {
  mockFetchJson.mockResolvedValue({ ...response, status: 'custody_pending' });
  render(<PaymentGatewayScreen />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Synthetic checkout callback' })
  );
  await waitFor(() =>
    expect(screen.getByText('Wallet funding pending')).toBeOnTheScreen()
  );
  expect(mockStorage.size).toBe(1);
  fireEvent.press(screen.getByRole('button', { name: 'Check funding status' }));
  await waitFor(() => expect(mockFetchJson).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByText('Wallet funding pending')).toBeOnTheScreen()
  );
  for (const [request] of mockFetchJson.mock.calls) {
    expect(request).toEqual({
      path: '/api/storefront/customer/wallet/primary-card/status',
      method: 'POST',
      includeCsrf: true,
      body: { merchantId, operationId },
    });
  }
  expect(mockInvalidate).not.toHaveBeenCalled();
  expect(mockClearCart).not.toHaveBeenCalled();
  const restarted = await createPrimaryWalletCardFundingClient().readPending({
    merchantId,
    userId: mockUserId,
  });
  expect(restarted).toMatchObject({ operationId, returnTo: mockReturnTo });
});

it('retains the operation through network error and recovers status from the actual UI without another charge', async () => {
  mockFetchJson.mockRejectedValueOnce(new Error('Synthetic network failure'));
  render(<PaymentGatewayScreen />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Synthetic checkout callback' })
  );
  await waitFor(() =>
    expect(screen.getByText('Could not check funding status')).toBeOnTheScreen()
  );
  expect(mockStorage.size).toBe(1);
  mockFetchJson.mockResolvedValue({ ...response, status: 'custody_pending' });
  await act(async () =>
    fireEvent.press(
      screen.getByRole('button', { name: 'Check funding status' })
    )
  );
  await waitFor(() =>
    expect(screen.getByText('Wallet funding pending')).toBeOnTheScreen()
  );
  expect(mockFetchJson).toHaveBeenCalledTimes(2);
  expect(mockStorage.size).toBe(1);
  expect(mockInvalidate).not.toHaveBeenCalled();
  expect(mockClearCart).not.toHaveBeenCalled();
});

it('shows the quotable operation reference on the pending view', async () => {
  mockFetchJson.mockResolvedValue({ ...response, status: 'custody_pending' });
  render(<PaymentGatewayScreen />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Synthetic checkout callback' })
  );
  await waitFor(() =>
    expect(screen.getByText('Wallet funding pending')).toBeOnTheScreen()
  );
  expect(
    screen.getByText(
      'Reference: pvb-first-primary-22222222-2222-4222-8222-222222222222'
    )
  ).toBeOnTheScreen();
});

it('shows the processing indicator while the primary server check runs', async () => {
  let release!: (value: unknown) => void;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  mockFetchJson.mockReturnValue(gate);
  render(<PaymentGatewayScreen />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Synthetic checkout callback' })
  );
  await waitFor(() =>
    expect(screen.getByText('Confirming Payment')).toBeOnTheScreen()
  );
  expect(
    screen.queryByRole('button', { name: 'Synthetic checkout callback' })
  ).toBeNull();
  release({ ...response, status: 'custody_pending' });
  await waitFor(() =>
    expect(screen.getByText('Wallet funding pending')).toBeOnTheScreen()
  );
});

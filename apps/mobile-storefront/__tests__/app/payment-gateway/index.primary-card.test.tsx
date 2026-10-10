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
let mockParamsUserId: string | undefined;
let mockParamsReference =
  'pvb-first-primary-22222222-2222-4222-8222-222222222222';
let mockParamsAuthorizationUrl = 'https://checkout.paystack.com/Synthetic123';
let mockParamsAmount = '1000';
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({
    paymentKind: 'primary_wallet_card',
    gateway: 'paystack',
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    reference: mockParamsReference,
    authorizationUrl: mockParamsAuthorizationUrl,
    amount: mockParamsAmount,
    returnTo: mockReturnTo,
    ...(mockParamsUserId ? { userId: mockParamsUserId } : {}),
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
  // New launches carry the owner stamp; the legacy (stampless) path has
  // dedicated tests below.
  mockParamsUserId = '11111111-1111-4111-8111-111111111111';
  mockParamsReference =
    'pvb-first-primary-22222222-2222-4222-8222-222222222222';
  mockParamsAuthorizationUrl = 'https://checkout.paystack.com/Synthetic123';
  mockParamsAmount = '1000';
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
  // Mounts recover the operation from the server before rendering: the
  // default fixture answers ready with the params URL and amount.
  mockFetchJson.mockClear();
  mockFetchJson.mockResolvedValue(response);
});

it('blocks another account through the actual controller and lets the original owner recover after signing back in', async () => {
  mockUserId = '44444444-4444-4444-8444-444444444444';
  const view = render(<PaymentGatewayScreen />);
  // The stamp mismatches: B never sees the WebView, only the way back.
  expect(
    screen.getByText(
      'Signed-in account changed. This checkout belongs to the previous account — go back so its owner can complete it.'
    )
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Synthetic checkout callback' })
  ).not.toBeOnTheScreen();
  expect(mockFetchJson).not.toHaveBeenCalled();
  expect(mockStorage.size).toBe(1);
  mockUserId = '11111111-1111-4111-8111-111111111111';
  // Mount recovery binds the server URL first, then the callback
  // reports custody.
  mockFetchJson
    .mockResolvedValueOnce(response)
    .mockResolvedValue({ ...response, status: 'custody_pending' });
  view.rerender(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Synthetic checkout callback' })
    ).toBeOnTheScreen()
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Synthetic checkout callback' })
  );
  await waitFor(() =>
    expect(screen.getByText('Wallet funding pending')).toBeOnTheScreen()
  );
  expect(mockFetchJson).toHaveBeenCalledTimes(2);
  expect(mockInvalidate).not.toHaveBeenCalled();
  expect(mockStorage.size).toBe(1);
});

it('blocks a stampless legacy launch whose device record belongs to nobody signed in', async () => {
  mockParamsUserId = undefined;
  mockStorage.clear();
  render(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(
      screen.getByText(
        'We could not find this funding for this account on this device. Return to your wallet to start a new funding — any completed checkout will still be found and credited.'
      )
    ).toBeOnTheScreen()
  );
  expect(
    screen.queryByRole('button', { name: 'Synthetic checkout callback' })
  ).not.toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Check funding status' })
  ).not.toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Return to wallet' })
  ).toBeOnTheScreen();
  expect(mockFetchJson).not.toHaveBeenCalled();
});

it('mounts a stampless legacy launch when the device record proves ownership', async () => {
  mockParamsUserId = undefined;
  mockFetchJson
    .mockResolvedValueOnce(response)
    .mockResolvedValue({ ...response, status: 'custody_pending' });
  render(<PaymentGatewayScreen />);
  // The beforeEach record (seeded by the real fund flow) matches this
  // reference, so the WebView mounts after the async check resolves.
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Synthetic checkout callback' })
    ).toBeOnTheScreen()
  );
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

it('blocks a stamped launch whose reference has no device record even when the stamp matches', async () => {
  // Forged deep link: the attacker stamps the victim's own id next to
  // another customer's checkout. The stamp comparison passes, so only
  // the persisted-record check can stop the WebView from mounting.
  mockStorage.clear();
  render(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(
      screen.getByText(
        'We could not find this funding for this account on this device. Return to your wallet to start a new funding — any completed checkout will still be found and credited.'
      )
    ).toBeOnTheScreen()
  );
  expect(
    screen.queryByRole('button', { name: 'Synthetic checkout callback' })
  ).not.toBeOnTheScreen();
  expect(mockFetchJson).not.toHaveBeenCalled();
});

it('blocks a stamped launch whose reference belongs to a different operation', async () => {
  // The victim owns a pending funding, but the crafted link points at
  // another customer's reference: the record mismatches, so the
  // checkout must not mount.
  mockParamsReference =
    'pvb-first-primary-55555555-5555-4555-8555-555555555555';
  render(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(
      screen.getByText(
        'We could not find this funding for this account on this device. Return to your wallet to start a new funding — any completed checkout will still be found and credited.'
      )
    ).toBeOnTheScreen()
  );
  expect(
    screen.queryByRole('button', { name: 'Synthetic checkout callback' })
  ).not.toBeOnTheScreen();
  expect(mockFetchJson).not.toHaveBeenCalled();
});

it('blocks a launch that pairs the owned reference with a foreign checkout URL', async () => {
  // The reference matches the device record, but the deep link carries
  // another customer's live Paystack session: mounting it would let the
  // victim authorize someone else's charge.
  mockParamsAuthorizationUrl = 'https://checkout.paystack.com/Attacker999';
  render(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(
      screen.getByText(
        'We could not confirm this checkout for your pending funding. Return to your wallet to check its status — do not start another charge if you already paid.'
      )
    ).toBeOnTheScreen()
  );
  expect(
    screen.queryByRole('button', { name: 'Synthetic checkout callback' })
  ).not.toBeOnTheScreen();
  expect(mockFetchJson).toHaveBeenCalledTimes(1);
});

it('blocks a launch that pairs the owned reference with a tampered amount', async () => {
  mockParamsAmount = '999999';
  render(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(
      screen.getByText(
        'We could not confirm this checkout for your pending funding. Return to your wallet to check its status — do not start another charge if you already paid.'
      )
    ).toBeOnTheScreen()
  );
  expect(
    screen.queryByRole('button', { name: 'Synthetic checkout callback' })
  ).not.toBeOnTheScreen();
});

it('blocks a stale checkout URL once the server advanced past ready', async () => {
  // No URL comes back for a custody-pending operation, so the params
  // URL (fresh or replayed) can never bind: the WebView must not mount
  // it, or the customer could pay twice on a stale session.
  const { authorizationUrl: _dropped, ...custody } = {
    ...response,
    status: 'custody_pending',
  };
  mockFetchJson.mockResolvedValue(custody);
  render(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(
      screen.getByText(
        'We could not confirm this checkout for your pending funding. Return to your wallet to check its status — do not start another charge if you already paid.'
      )
    ).toBeOnTheScreen()
  );
  expect(
    screen.queryByRole('button', { name: 'Synthetic checkout callback' })
  ).not.toBeOnTheScreen();
});

it('blocks the checkout when the server cannot confirm it at mount', async () => {
  mockFetchJson.mockRejectedValue(new Error('Synthetic network failure'));
  render(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(
      screen.getByText(
        'We could not confirm this checkout for your pending funding. Return to your wallet to check its status — do not start another charge if you already paid.'
      )
    ).toBeOnTheScreen()
  );
  expect(
    screen.queryByRole('button', { name: 'Synthetic checkout callback' })
  ).not.toBeOnTheScreen();
});

it('hides the mounted primary checkout when the account switches after navigation', async () => {
  mockParamsUserId = '11111111-1111-4111-8111-111111111111';
  const view = render(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Synthetic checkout callback' })
    ).toBeOnTheScreen()
  );
  // User B signs in while A's checkout stays mounted: the WebView must
  // disappear so B can never enter card details into A's charge.
  mockFetchJson.mockClear();
  mockUserId = '44444444-4444-4444-8444-444444444444';
  view.rerender(<PaymentGatewayScreen />);
  expect(
    screen.getByText(
      'Signed-in account changed. This checkout belongs to the previous account — go back so its owner can complete it.'
    )
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Synthetic checkout callback' })
  ).not.toBeOnTheScreen();
  // No status check for the non-owner: only the way back stays.
  expect(
    screen.queryByRole('button', { name: 'Check funding status' })
  ).not.toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Return to wallet' })
  ).toBeOnTheScreen();
  expect(mockFetchJson).not.toHaveBeenCalled();
  // A signs back in: the owner's checkout returns.
  mockUserId = '11111111-1111-4111-8111-111111111111';
  view.rerender(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Synthetic checkout callback' })
    ).toBeOnTheScreen()
  );
});

it('checks the same durable operation through the actual callback, pending button and controller after restart', async () => {
  mockFetchJson
    .mockResolvedValueOnce(response)
    .mockResolvedValue({ ...response, status: 'custody_pending' });
  render(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Synthetic checkout callback' })
    ).toBeOnTheScreen()
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Synthetic checkout callback' })
  );
  await waitFor(() =>
    expect(screen.getByText('Wallet funding pending')).toBeOnTheScreen()
  );
  expect(mockStorage.size).toBe(1);
  fireEvent.press(screen.getByRole('button', { name: 'Check funding status' }));
  await waitFor(() => expect(mockFetchJson).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(screen.getByText('Wallet funding pending')).toBeOnTheScreen()
  );
  for (const [request] of mockFetchJson.mock.calls) {
    expect(request).toEqual({
      path: '/api/storefront/customer/wallet/primary-card/status',
      method: 'POST',
      includeCsrf: true,
      // The status poll binds the token to the record owner: a session
      // switch mid-poll rejects before the request is sent.
      expectedUserId: mockUserId,
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
  mockFetchJson
    .mockResolvedValueOnce(response)
    .mockRejectedValueOnce(new Error('Synthetic network failure'));
  render(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Synthetic checkout callback' })
    ).toBeOnTheScreen()
  );
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
  expect(mockFetchJson).toHaveBeenCalledTimes(3);
  expect(mockStorage.size).toBe(1);
  expect(mockInvalidate).not.toHaveBeenCalled();
  expect(mockClearCart).not.toHaveBeenCalled();
});

it('shows the quotable operation reference on the pending view', async () => {
  mockFetchJson
    .mockResolvedValueOnce(response)
    .mockResolvedValue({ ...response, status: 'custody_pending' });
  render(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Synthetic checkout callback' })
    ).toBeOnTheScreen()
  );
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
  mockFetchJson.mockResolvedValueOnce(response);
  mockFetchJson.mockReturnValue(gate);
  render(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Synthetic checkout callback' })
    ).toBeOnTheScreen()
  );
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

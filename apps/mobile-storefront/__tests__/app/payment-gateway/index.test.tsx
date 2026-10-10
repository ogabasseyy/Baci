import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { router } from 'expo-router';
import PaymentGatewayScreen from '@/app/payment-gateway';

const mockRetry = jest.fn();
let mockStatus = 'pending';
let mockReturnTo: string | undefined;
jest.mock('@/lib/primary-wallet-card', () => ({
  // These tests route by status, not ownership: the device record
  // always proves the launch belongs to the current user.
  createPrimaryWalletCardFundingClient: () => ({
    readPending: async () => ({
      operationId: '22222222-2222-4222-8222-222222222222',
    }),
  }),
}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  Stack: { Screen: () => null },
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ id: '11111111-1111-4111-8111-111111111111' }),
}));
jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: require('react-native').View,
}));
jest.mock(
  '@/components/payment-gateway/use-payment-gateway-controller',
  () => ({
    usePaymentGatewayController: () => ({
      // Stamped owner launch whose device record proves ownership.
      validatedParams: {
        isValid: true,
        data: {
          userId: '11111111-1111-4111-8111-111111111111',
          merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
          reference: 'pvb-first-primary-22222222-2222-4222-8222-222222222222',
        },
      },
      paymentKind: 'primary_wallet_card',
      status: mockStatus,
      errorMessage: null,
      handleRetry: mockRetry,
      returnTo: mockReturnTo,
    }),
  })
);
jest.mock('@/components/payment-gateway/PaymentGatewayCheckoutView', () => ({
  PaymentGatewayCheckoutView: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockReturnTo = undefined;
});

it.each([
  ['pending', 'Wallet funding pending'],
  ['error', 'Could not check funding status'],
  // A never-emitted 'held' stays on primary funding copy instead of
  // leaking into the generic Redvault held view.
  ['held', 'Wallet funding pending'],
])('routes primary %s to safe funding status UI, not failed payment or orders', async (status, title) => {
  mockStatus = status;
  render(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(screen.getByRole('header').props.children).toBe(title)
  );
  expect(screen.getByRole('alert').props.children).toContain(
    'Do not pay again'
  );
  expect(screen.queryByText('View your orders')).toBeNull();
  expect(screen.queryByText('Payment Failed')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Check funding status' }));
  expect(mockRetry).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: 'Return to wallet' }));
  expect(router.replace).toHaveBeenCalledWith('/wallet');
});

it('fails closed to primary funding copy on an unknown future status', async () => {
  mockStatus = 'future-terminal-state';
  render(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(screen.getByRole('header').props.children).toBe(
      'Wallet funding pending'
    )
  );
  expect(screen.queryByText('View your orders')).toBeNull();
  expect(screen.queryByText('Payment Failed')).toBeNull();
});

it('resumes the saved savings handoff when leaving the pending funding view', async () => {
  mockStatus = 'pending';
  mockReturnTo = '/wallet?action=savings&savingsGoalId=owned-goal';
  render(<PaymentGatewayScreen />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Return to wallet' })
    ).toBeOnTheScreen()
  );
  fireEvent.press(screen.getByRole('button', { name: 'Return to wallet' }));
  expect(router.replace).toHaveBeenCalledWith(mockReturnTo);
});

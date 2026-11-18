// Register the shared mocks before importing the mocked modules below.
import '@/test-support/wallet-checkout-fixture';
import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import PaymentGatewayScreen from '@/app/payment-gateway';
import { setWalletSearchParams } from '@/test-support/wallet-checkout-fixture';

const OWNER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER = '44444444-4444-4444-8444-444444444444';
let mockUserId: string = OWNER;
jest.mock('@/stores/auth-store', () => {
  const state = () => ({
    customer: null,
    isInitialized: true,
    user: { id: mockUserId },
  });
  const useAuthStore = (selector: (s: unknown) => unknown) => selector(state());
  useAuthStore.getState = state;
  return { useAuthStore };
});

const CHANGED =
  'Signed-in account changed. This checkout belongs to the previous account — go back so its owner can complete it.';

function openLegacyCheckout() {
  setWalletSearchParams({
    amount: '1000',
    authorizationUrl: 'https://checkout.paystack.com/test',
    gateway: 'paystack',
    merchantId: 'merchant-1',
    paymentKind: 'wallet',
    reference: 'WAL-123',
    userId: OWNER,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PaymentGatewayScreen />
    </QueryClientProvider>
  );
}

// The store credit card top-up is today's flow: PiggyVest off changes
// nothing for the account that started it.
describe('legacy wallet checkout with the server keeping PiggyVest off', () => {
  it('shows the checkout to the account that started it', () => {
    mockUserId = OWNER;
    openLegacyCheckout();

    expect(screen.queryByText(CHANGED)).toBeNull();
  });
});

describe('bugfix: another account could pay into the previous account’s checkout', () => {
  it('blocks the checkout once a different account is signed in', () => {
    // Arrange: account A's checkout is open; account B signs in.
    mockUserId = OTHER;

    // Act
    openLegacyCheckout();

    // Assert: only the way back, never A's card form.
    expect(screen.getByText(CHANGED)).toBeOnTheScreen();
    mockUserId = OWNER;
  });
});
